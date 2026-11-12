import { afterEach, expect, test } from 'bun:test';
import { setTimeout as sleep } from 'node:timers/promises';

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

const stubConnection = (id: string, connected: boolean) => {
  const stub = {
    connected,
    published: [] as unknown[],
    url: 'ws://127.0.0.1:9090',
    isConnected: () => stub.connected,
    getDebugStatus: () => ({ id, connected: stub.connected }),
    publish: (_topic: string, _msgType: string, message: unknown) => {
      if (!stub.connected) throw new Error(`ROS connection ${id} not ready`);
      stub.published.push(message);
    },
    disconnect: () => {},
  };
  return stub;
};

const createTeleopManager = ({
  controlUp,
  defaultUp = true,
  watchdogMs = 10,
}: {
  controlUp: boolean;
  defaultUp?: boolean;
  watchdogMs?: number;
}) => {
  const manager = new RosRobotManager({
    id: 'robot-1',
    connections: [
      { id: 'default', url: 'ws://127.0.0.1:9090' },
      { id: 'control', url: 'ws://127.0.0.1:9090' },
    ],
    teleopLimits: { watchdogMs },
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
  const control = stubConnection('control', controlUp);
  const fallback = stubConnection('default', defaultUp);
  (manager as any).connections.set('control', control);
  (manager as any).connections.set('default', fallback);
  const errors: Error[] = [];
  manager.on('error', (error: Error) => errors.push(error));
  return { manager, control, fallback, errors };
};

const MOTION = { linear: { x: 0.25, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0.1 } };
const STOP = { linear: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } };
const drive = (manager: InstanceType<typeof RosRobotManager>) =>
  manager.handleCommand('teleop', { linear: { x: 0.25 }, angular: { z: 0.1 } });
const watchdogFires = () => sleep(40);

afterEach(() => {
  while (managers.length > 0) {
    managers.pop()?.stop();
  }
});

test('watchdog stop reaches the fallback connection teleop is using while control is down', async () => {
  const { manager, fallback } = createTeleopManager({ controlUp: false });

  expect(drive(manager)).toMatchObject({ ok: true, connectionId: 'default' });
  await watchdogFires();

  expect(fallback.published).toEqual([MOTION, STOP]);
});

test('stop() reaches the fallback connection teleop is using while control is down', () => {
  const { manager, fallback } = createTeleopManager({ controlUp: false, watchdogMs: 60_000 });

  drive(manager);
  manager.stop();

  expect(fallback.published).toEqual([MOTION, STOP]);
});

test('stop follows teleop onto the fallback even when control has just come back', async () => {
  const { manager, control, fallback } = createTeleopManager({ controlUp: false });

  drive(manager);
  control.connected = true;
  await watchdogFires();

  expect(fallback.published).toEqual([MOTION, STOP]);
});

test('stop reaches the fallback when the control connection does not exist', async () => {
  const { manager, fallback } = createTeleopManager({ controlUp: false });
  (manager as any).connections.delete('control');

  expect(drive(manager)).toMatchObject({ ok: true, connectionId: 'default' });
  await watchdogFires();

  expect(fallback.published).toEqual([MOTION, STOP]);
});

test('stop falls back when the connection teleop was using has since dropped', async () => {
  const { manager, control, fallback } = createTeleopManager({ controlUp: true });

  drive(manager);
  control.connected = false;
  await watchdogFires();

  expect(control.published).toEqual([MOTION]);
  expect(fallback.published).toEqual([STOP]);
});

test('stop stays on control during normal teleop', async () => {
  const { manager, control, fallback } = createTeleopManager({ controlUp: true });

  drive(manager);
  await watchdogFires();

  expect(control.published).toEqual([MOTION, STOP]);
  expect(fallback.published).toEqual([]);
});

test('reports a stop that no connection could carry', async () => {
  const { manager, errors } = createTeleopManager({ controlUp: true });

  drive(manager);
  (manager as any).connections.get('control').connected = false;
  (manager as any).connections.get('default').connected = false;
  await watchdogFires();

  expect(errors.map(error => error.message)).toEqual([
    expect.stringContaining('Teleop stop not delivered'),
  ]);
});

test('a stop no connection could carry goes out when a connection comes back', async () => {
  const { manager, control, fallback, errors } = createTeleopManager({ controlUp: true });

  drive(manager);
  control.connected = false;
  fallback.connected = false;
  await watchdogFires();
  expect(errors).toHaveLength(1);

  fallback.connected = true;
  await sleep(300);

  expect(fallback.published).toContainEqual(STOP);
  expect(errors).toHaveLength(1);
});

test('a new command replaces a stop that was still pending', async () => {
  const { manager, control, errors } = createTeleopManager({ controlUp: false, defaultUp: false });

  drive(manager);
  await watchdogFires();
  expect(errors.at(-1)?.message).toContain('Teleop stop not delivered');
  (manager as any).teleopLimits.watchdogMs = 60_000;

  control.connected = true;
  expect(drive(manager)).toMatchObject({ ok: true, connectionId: 'control' });
  await sleep(300);

  expect(control.published).toEqual([MOTION]);
});

test('stopping the manager gives up a pending stop and reports it', async () => {
  const { manager, fallback, errors } = createTeleopManager({ controlUp: false, defaultUp: false });

  drive(manager);
  await watchdogFires();
  const reported = errors.length;

  manager.stop();
  expect(errors).toHaveLength(reported + 1);
  expect(errors.at(-1)?.message).toContain('Teleop stop not delivered');

  fallback.connected = true;
  await sleep(300);
  expect(fallback.published).toEqual([]);
});

test('stopping an idle manager with nothing connected reports nothing', () => {
  const { manager, errors } = createTeleopManager({ controlUp: false, defaultUp: false });

  manager.stop();

  expect(errors).toEqual([]);
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
