import { afterEach, expect, test } from 'bun:test';

delete process.env['ROS_ODOM_RATE_HZ'];
delete process.env['ROS_LASER_RATE_HZ'];
delete process.env['ROS_SCAN_POSE_RATE_HZ'];
delete process.env['ROS_AMCL_RATE_HZ'];

const { RosRegistry } = await import('./rosRegistry.js');

const registries: InstanceType<typeof RosRegistry>[] = [];

const createLogger = () =>
  ({
    error: () => {},
  }) as any;

const createPrisma = () =>
  ({
    robot: {
      findMany: async () => [
        {
          id: 'robot-1',
          ipAddress: '127.0.0.1',
          bridgePort: 9090,
          mappingBridgePort: null,
          channels: [
            {
              name: 'laser',
              topic: '/scan_ui',
              msgType: 'sensor_msgs/LaserScan',
              direction: 'subscribe',
              rateLimitHz: 10,
            },
            {
              name: 'teleop',
              topic: '/cmd_vel_ui',
              msgType: 'geometry_msgs/Twist',
              direction: 'publish',
            },
          ],
        },
      ],
    },
  }) as any;

afterEach(() => {
  while (registries.length > 0) {
    registries.pop()?.stop();
  }
});

test('uses trimmed default telemetry rates for ROS bridge channels', async () => {
  const registry = new RosRegistry(createPrisma(), createLogger());
  registries.push(registry);

  await registry.reloadFromDb();

  const manager = registry.getManager('robot-1') as any;
  const rates = Object.fromEntries(
    manager.config.channels.map((channel: any) => [channel.name, channel.rateLimitHz])
  );
  const channels = Object.fromEntries(
    manager.config.channels.map((channel: any) => [channel.name, channel])
  );

  expect(rates).toMatchObject({
    odom: 5,
    laser: 3,
    scanPose: 5,
    waypoints: 2,
    amcl: 4,
  });
  expect(channels['teleop']).toMatchObject({
    msgType: 'geometry_msgs/msg/Twist',
    connectionId: 'control',
  });
  expect(manager.config.connections).toEqual(
    expect.arrayContaining([
      { id: 'default', url: 'ws://127.0.0.1:9090' },
      { id: 'control', url: 'ws://127.0.0.1:9090' },
    ])
  );
});
