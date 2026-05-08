// @ts-nocheck
import { RosRobotManager } from './rosRobotManager.js';

const DEFAULT_PORT = Number(process.env['ROS_BRIDGE_PORT'] ?? 9090);
const DEFAULT_MAPPING_PORT = Number(process.env['ROS_MAPPING_BRIDGE_PORT'] ?? 8765);

const serializeConfig = (config: any) => {
  const connections = Array.isArray(config?.connections)
    ? [...config.connections].sort((a, b) => (a.id ?? '').localeCompare(b.id ?? ''))
    : [];
  const channels = Array.isArray(config?.channels)
    ? [...config.channels].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
    : [];

  return JSON.stringify({
    bridgeUrl: config?.bridgeUrl,
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
  odom: parseRateLimit('ROS_ODOM_RATE_HZ', 8),
  laser: parseRateLimit('ROS_LASER_RATE_HZ', 3),
  amcl: parseRateLimit('ROS_AMCL_RATE_HZ', 4),
};

const msgTypeOverrides: Record<string, string | undefined> = {
  laser: parseMsgTypeOverride('ROS_LASER_MSG_TYPE'),
};

const normalizeChannels = (channels: any[] | undefined) => {
  if (!Array.isArray(channels) || channels.length === 0) return undefined;
  return channels.map(ch => ({
    ...ch,
    msgType: msgTypeOverrides[ch.name] ?? (ch.msgType ? normalizeMsgType(ch.msgType) : ch.msgType),
    rateLimitHz: rateLimitOverrides[ch.name] ?? ch.rateLimitHz,
  }));
};

const defaultChannels = [
  {
    name: 'odom',
    topic: '/odom_ui',
    msgType: 'nav_msgs/msg/Odometry',
    direction: 'subscribe',
    rateLimitHz: 5,
  },
  {
    name: 'laser',
    topic: '/scan_ui',
    msgType: msgTypeOverrides.laser ?? 'sensor_msgs/msg/LaserScan',
    direction: 'subscribe',
    rateLimitHz: 10,
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
  },
  {
    name: 'amcl',
    topic: '/amcl_pose_ui',
    msgType: 'geometry_msgs/msg/PoseWithCovarianceStamped',
    direction: 'subscribe',
    rateLimitHz: 5,
  },
  {
    name: 'initialpose',
    topic: '/initialpose_ui',
    msgType: 'geometry_msgs/msg/PoseWithCovarianceStamped',
    direction: 'publish',
  },
];

const _mergeChannels = (base: any[], custom: any[] | undefined) => {
  if (!Array.isArray(custom) || custom.length === 0) return base;
  const byName = new Map<string, any>();
  for (const ch of base) {
    byName.set(ch.name, ch);
  }
  for (const ch of custom) {
    byName.set(ch.name, ch);
  }
  return Array.from(byName.values());
};

export class RosRegistry {
  constructor(prisma, logger) {
    this.prisma = prisma;
    this.logger = logger;
    this.managers = new Map();
  }

  async reloadFromDb() {
    const robots = await this.prisma.robot.findMany();
    const desiredIds = new Set();

    for (const robot of robots) {
      if (!robot.ipAddress) {
        continue;
      }
      const bridgePort = (robot as any).bridgePort ?? DEFAULT_PORT;
      const configuredMappingPort = (robot as any).mappingBridgePort;
      const resolvedMappingPort =
        configuredMappingPort ??
        (process.env['ROS_MAPPING_BRIDGE_PORT'] ? DEFAULT_MAPPING_PORT : undefined);
      const bridgeUrl = `ws://${robot.ipAddress}:${bridgePort}`;
      const connections: Array<{ id: string; url: string }> = [{ id: 'default', url: bridgeUrl }];

      // Only attach the mapping connection when requested per-robot or via env
      if (resolvedMappingPort) {
        connections.push({
          id: 'mapping',
          url: `ws://${robot.ipAddress}:${resolvedMappingPort}`,
        });
      }
      const channels = _mergeChannels(defaultChannels, normalizeChannels((robot as any).channels));
      const robotId = robot.id;
      desiredIds.add(robotId);

      const nextConfig = {
        id: robotId,
        bridgeUrl,
        connections,
        channels,
      };

      const existing = this.managers.get(robotId);
      if (existing && serializeConfig((existing as any).config) === serializeConfig(nextConfig)) {
        continue;
      }

      existing?.stop();
      const manager = new RosRobotManager(nextConfig);
      const formatErr = (e: any) =>
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
      manager.start().catch(error => {
        this.logger?.error({ robotId, err: formatErr(error) }, 'Failed to start ROS manager');
      });
    }

    // Remove stale managers
    for (const [robotId, manager] of this.managers.entries()) {
      if (!desiredIds.has(robotId)) {
        manager.stop();
        this.managers.delete(robotId);
      }
    }
  }

  getManager(robotId) {
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
