import EventEmitter from 'node:events';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { withApprovedAddress } from './robotAddress.js';
import { type RosChannelConfig, type RosRobotConfig, RosRobotManager } from './rosRobotManager.js';

const DEFAULT_PORT = Number(process.env['ROS_BRIDGE_PORT'] ?? 9090);
const DEFAULT_MAPPING_PORT = Number(process.env['ROS_MAPPING_BRIDGE_PORT'] ?? 8765);
const DEFAULT_CONNECTION_ID = 'default';
const CONTROL_CONNECTION_ID = 'control';

const serializeConfig = (config: RosRobotConfig) => {
  const connections = [...(config.connections ?? [])].sort((a, b) =>
    (a.id ?? '').localeCompare(b.id ?? '')
  );
  // Stored channels reach here through a cast from JSON, so a name is not guaranteed.
  const channels = [...(config.channels ?? [])].sort((a, b) =>
    (a.name ?? '').localeCompare(b.name ?? '')
  );

  return JSON.stringify({
    bridgeUrl: config.bridgeUrl,
    connections: connections.map(c => ({ id: c.id, url: c.url })),
    channels: channels.map(ch => ({
      name: ch.name,
      topic: ch.topic,
      msgType: ch.msgType,
      direction: ch.direction,
      rateLimitHz: ch.rateLimitHz,
      connectionId: ch.connectionId,
    })),
  });
};

const normalizeMsgType = (msgType: string) => {
  const map: Record<string, string> = {
    'nav_msgs/Odometry': 'nav_msgs/msg/Odometry',
    'sensor_msgs/LaserScan': 'sensor_msgs/msg/LaserScan',
    'nav_msgs/Path': 'nav_msgs/msg/Path',
    'std_msgs/String': 'std_msgs/msg/String',
    'geometry_msgs/Twist': 'geometry_msgs/msg/Twist',
    'geometry_msgs/PoseStamped': 'geometry_msgs/msg/PoseStamped',
    'geometry_msgs/PoseWithCovarianceStamped': 'geometry_msgs/msg/PoseWithCovarianceStamped',
  };
  return map[msgType] ?? msgType;
};

const parseRateLimit = (envKey: string, fallback: number) => {
  const raw = Number(process.env[envKey] ?? fallback);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return raw;
};

const parseMsgTypeOverride = (envKey: string) => {
  const raw = process.env[envKey]?.trim();
  return raw ? normalizeMsgType(raw) : undefined;
};

const rateLimitOverrides: Record<string, number> = {
  odom: parseRateLimit('ROS_ODOM_RATE_HZ', 5),
  laser: parseRateLimit('ROS_LASER_RATE_HZ', 3),
  scanPose: parseRateLimit('ROS_SCAN_POSE_RATE_HZ', 5),
  amcl: parseRateLimit('ROS_AMCL_RATE_HZ', 4),
};

const msgTypeOverrides: Record<string, string | undefined> = {
  laser: parseMsgTypeOverride('ROS_LASER_MSG_TYPE'),
  scanPose: parseMsgTypeOverride('ROS_SCAN_POSE_MSG_TYPE'),
};

// robots.ts validates channels against RosChannelSchema before storing them.
const normalizeChannels = (channels: Prisma.JsonValue | null): RosChannelConfig[] | undefined => {
  if (!Array.isArray(channels) || channels.length === 0) return undefined;
  return (channels as RosChannelConfig[]).map(ch => ({
    ...ch,
    msgType: msgTypeOverrides[ch.name] ?? (ch.msgType ? normalizeMsgType(ch.msgType) : ch.msgType),
    rateLimitHz: rateLimitOverrides[ch.name] ?? ch.rateLimitHz,
  }));
};

const defaultChannels: RosChannelConfig[] = [
  {
    name: 'odom',
    topic: '/odom_ui',
    msgType: 'nav_msgs/msg/Odometry',
    direction: 'subscribe',
    rateLimitHz: rateLimitOverrides['odom'],
  },
  {
    name: 'laser',
    topic: '/scan_ui',
    msgType: msgTypeOverrides['laser'] ?? 'sensor_msgs/msg/LaserScan',
    direction: 'subscribe',
    rateLimitHz: rateLimitOverrides['laser'],
  },
  {
    name: 'scanPose',
    topic: '/scan_pose_ui',
    msgType: msgTypeOverrides['scanPose'] ?? 'geometry_msgs/msg/PoseStamped',
    direction: 'subscribe',
    rateLimitHz: rateLimitOverrides['scanPose'],
  },
  {
    name: 'waypoints',
    topic: '/plan_ui',
    msgType: 'nav_msgs/msg/Path',
    direction: 'subscribe',
    rateLimitHz: 2,
  },
  {
    name: 'teleop',
    topic: '/cmd_vel_ui',
    msgType: 'geometry_msgs/msg/Twist',
    direction: 'publish',
    connectionId: CONTROL_CONNECTION_ID,
  },
  {
    name: 'amcl',
    topic: '/amcl_pose_ui',
    msgType: 'geometry_msgs/msg/PoseWithCovarianceStamped',
    direction: 'subscribe',
    rateLimitHz: rateLimitOverrides['amcl'],
  },
  {
    name: 'initialpose',
    topic: '/initialpose_ui',
    msgType: 'geometry_msgs/msg/PoseWithCovarianceStamped',
    direction: 'publish',
    connectionId: CONTROL_CONNECTION_ID,
  },
];

const mergeChannels = (base: RosChannelConfig[], custom: RosChannelConfig[] | undefined) => {
  if (!custom?.length) return base;
  const byName = new Map<string, RosChannelConfig>();
  for (const ch of base) {
    byName.set(ch.name, ch);
  }
  for (const ch of custom) {
    byName.set(ch.name, { ...(byName.get(ch.name) ?? {}), ...ch });
  }
  return Array.from(byName.values());
};

export class RosRegistry extends EventEmitter {
  private managers = new Map<string, RosRobotManager>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: FastifyBaseLogger
  ) {
    super();
    this.setMaxListeners(0);
  }

  // A reload stops a robot's manager and may start another. Anything forwarding its events has to
  // move with it, or it stays subscribed to a manager that will never emit again.
  onManagerChange(robotId: string, listener: (manager: RosRobotManager | undefined) => void) {
    const event = `manager:${robotId}`;
    this.on(event, listener);
    return () => this.off(event, listener);
  }

  async reloadFromDb() {
    const robots = await withApprovedAddress(this.prisma, await this.prisma.robot.findMany());
    const desiredIds = new Set<string>();

    for (const robot of robots) {
      if (!robot.ipAddress) {
        continue;
      }
      const bridgePort = robot.bridgePort ?? DEFAULT_PORT;
      const configuredMappingPort = robot.mappingBridgePort;
      const resolvedMappingPort =
        configuredMappingPort ??
        (process.env['ROS_MAPPING_BRIDGE_PORT'] ? DEFAULT_MAPPING_PORT : undefined);
      const bridgeUrl = `ws://${robot.ipAddress}:${bridgePort}`;
      const connections: Array<{ id: string; url: string }> = [
        { id: DEFAULT_CONNECTION_ID, url: bridgeUrl },
        { id: CONTROL_CONNECTION_ID, url: bridgeUrl },
      ];

      // Only attach the mapping connection when requested per-robot or via env
      if (resolvedMappingPort) {
        connections.push({
          id: 'mapping',
          url: `ws://${robot.ipAddress}:${resolvedMappingPort}`,
        });
      }
      const channels = mergeChannels(defaultChannels, normalizeChannels(robot.channels));
      const robotId = robot.id;
      desiredIds.add(robotId);

      const nextConfig: RosRobotConfig = {
        id: robotId,
        bridgeUrl,
        connections,
        channels,
      };

      const existing = this.managers.get(robotId);
      if (existing && serializeConfig(existing.config) === serializeConfig(nextConfig)) {
        continue;
      }

      existing?.stop();
      const manager = new RosRobotManager(nextConfig);
      const formatErr = (e: unknown) =>
        e instanceof Error ? { message: e.message, name: e.name, stack: e.stack } : e;
      const lastErrorLogAt = new Map<string, number>();
      const shouldLog = (key: string, intervalMs = 60_000) => {
        const now = Date.now();
        const last = lastErrorLogAt.get(key) ?? 0;
        if (now - last < intervalMs) return false;
        lastErrorLogAt.set(key, now);
        return true;
      };
      manager.on('error', error => {
        const key = error instanceof Error ? error.message : String(error);
        if (!shouldLog(key)) return;
        this.logger?.error({ robotId, err: formatErr(error) }, 'ROS manager error');
      });
      this.managers.set(robotId, manager);
      this.emit(`manager:${robotId}`, manager);
      manager.start().catch(error => {
        this.logger?.error({ robotId, err: formatErr(error) }, 'Failed to start ROS manager');
      });
    }

    // Remove stale managers
    for (const [robotId, manager] of this.managers.entries()) {
      if (!desiredIds.has(robotId)) {
        manager.stop();
        this.managers.delete(robotId);
        this.emit(`manager:${robotId}`, undefined);
      }
    }
  }

  getManager(robotId: string) {
    return this.managers.get(robotId);
  }

  stop() {
    for (const manager of this.managers.values()) {
      manager.stop();
    }
    this.managers.clear();
  }

  getStatuses() {
    return Array.from(this.managers.values()).map(manager => manager.getStatus());
  }
}
