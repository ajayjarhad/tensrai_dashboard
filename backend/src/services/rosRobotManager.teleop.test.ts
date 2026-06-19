import { afterEach, expect, test } from 'bun:test';

const { RosRobotManager } = await import('./rosRobotManager.js');

const managers: InstanceType<typeof RosRobotManager>[] = [];

const createManager = (bufferedAmount: number) => {
  const published: unknown[] = [];
  const manager = new RosRobotManager({
    id: 'robot-1',
    connections: [{ id: 'default', url: 'ws://127.0.0.1:9090' }],
    teleopLimits: { watchdogMs: 0 },
    channels: [
      {
        name: 'teleop',
        topic: '/cmd_vel_ui',
        msgType: 'geometry_msgs/msg/Twist',
        direction: 'publish',
      },
    ],
  } as any);
  managers.push(manager);

  (manager as any).connections.set('default', {
    isConnected: () => true,
    url: 'ws://127.0.0.1:9090',
    getDebugStatus: () => ({
      id: 'default',
      url: 'ws://127.0.0.1:9090',
      connected: true,
      bufferedAmount,
    }),
    publish: (_topic: string, _msgType: string, message: unknown) => {
      published.push(message);
    },
    disconnect: () => {},
  });

  return { manager, published };
};

const createManagerWithControlFallback = () => {
  const published: unknown[] = [];
  const manager = new RosRobotManager({
    id: 'robot-1',
    connections: [
      { id: 'default', url: 'ws://127.0.0.1:9090' },
      { id: 'control', url: 'ws://127.0.0.1:9090' },
    ],
    teleopLimits: { watchdogMs: 0 },
    channels: [
      {
        name: 'teleop',
        topic: '/cmd_vel_ui',
        msgType: 'geometry_msgs/msg/Twist',
        direction: 'publish',
        connectionId: 'control',
      },
    ],
  } as any);
  managers.push(manager);

  (manager as any).connections.set('control', {
    isConnected: () => false,
    url: 'ws://127.0.0.1:9090',
    getDebugStatus: () => ({
      id: 'control',
      url: 'ws://127.0.0.1:9090',
      connected: false,
    }),
    publish: () => {
      throw new Error('ROS connection control not ready');
    },
    disconnect: () => {},
  });

  (manager as any).connections.set('default', {
    isConnected: () => true,
    url: 'ws://127.0.0.1:9090',
    getDebugStatus: () => ({
      id: 'default',
      url: 'ws://127.0.0.1:9090',
      connected: true,
      bufferedAmount: 0,
    }),
    publish: (_topic: string, _msgType: string, message: unknown) => {
      published.push(message);
    },
    disconnect: () => {},
  });

  return { manager, published };
};

afterEach(() => {
  while (managers.length > 0) {
    managers.pop()?.stop();
  }
});

test('publishes teleop commands even when the ROS bridge socket has backlog', () => {
  const { manager, published } = createManager(2048);

  const result = manager.handleCommand('teleop', {
    linear: { x: 0.25 },
    angular: { z: 0.1 },
  });

  expect(result).toMatchObject({
    ok: true,
    channelName: 'teleop',
    connection: {
      bufferedAmount: 2048,
    },
  });
  expect(published).toEqual([
    {
      linear: { x: 0.25, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: 0.1 },
    },
  ]);
});

test('publishes teleop commands when the ROS bridge socket has no backlog', () => {
  const { manager, published } = createManager(0);

  const result = manager.handleCommand('teleop', {
    linear: { x: 0.25 },
    angular: { z: 0.1 },
  });

  expect(result).toMatchObject({
    ok: true,
    channelName: 'teleop',
  });
  expect(published).toEqual([
    {
      linear: { x: 0.25, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: 0.1 },
    },
  ]);
});

test('falls back to the default ROS connection when control publish is unavailable', () => {
  const { manager, published } = createManagerWithControlFallback();

  const result = manager.handleCommand('teleop', {
    linear: { x: 0.25 },
    angular: { z: 0.1 },
  });

  expect(result).toMatchObject({
    ok: true,
    channelName: 'teleop',
    connectionId: 'default',
    fallbackFromConnectionId: 'control',
    primaryError: 'ROS connection control not ready',
  });
  expect(published).toEqual([
    {
      linear: { x: 0.25, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: 0.1 },
    },
  ]);
});
