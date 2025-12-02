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
  };
  return map[msgType] ?? msgType;
};

const rateLimitOverrides: Record<string, number> = {
  odom: 2, // 2 Hz (0.5s)
  laser: 1, // 1 Hz (1s)
};

const normalizeChannels = (channels: any[] | undefined) => {
  if (!Array.isArray(channels) || channels.length === 0) return undefined;
  return channels.map(ch => ({
    ...ch,
    msgType: ch.msgType ? normalizeMsgType(ch.msgType) : ch.msgType,
    rateLimitHz: rateLimitOverrides[ch.name] ?? ch.rateLimitHz,
  }));
};

const defaultChannels = [
  {
    name: 'odom',
    topic: '/odom',
    msgType: 'nav_msgs/msg/Odometry',
    direction: 'subscribe',
    rateLimitHz: 5,
  },
  {
    name: 'laser',
    topic: '/scan',
    msgType: 'sensor_msgs/msg/LaserScan',
    direction: 'subscribe',
    rateLimitHz: 10,
  },
  {
    name: 'waypoints',
    topic: '/plan',
    msgType: 'nav_msgs/msg/Path',
    direction: 'subscribe',
    rateLimitHz: 2,
  },
  {
    name: 'teleop',
    topic: '/cmd_vel',
    msgType: 'geometry_msgs/msg/Twist',
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
      const channels = normalizeChannels((robot as any).channels) ?? defaultChannels;
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
      manager.on('error', error => {
        this.logger?.error({ robotId, error }, 'ROS manager error');
      });
      this.managers.set(robotId, manager);
      manager.start().catch(error => {
        this.logger?.error({ robotId, error }, 'Failed to start ROS manager');
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
