import { afterEach, expect, test } from 'bun:test';

const { RosRobotManager } = await import('./rosRobotManager.js');

const managers: InstanceType<typeof RosRobotManager>[] = [];

const createManager = () => {
  const manager = new RosRobotManager({
    id: 'robot-1',
    connections: [{ id: 'default', url: 'ws://127.0.0.1:9090' }],
    teleopLimits: { watchdogMs: 0 },
    channels: [],
  } as any);
  managers.push(manager);
  return manager as any;
};

const makePath = (count: number) => ({
  header: { frame_id: 'map' },
  poses: Array.from({ length: count }, (_, i) => ({
    pose: { position: { x: i, y: i * 2, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
  })),
});

const emitWaypoints = (manager: any, path: unknown) => {
  let emitted: any;
  manager.on('channel-data', (event: any) => {
    emitted = event.data;
  });
  manager.emitChannelData('waypoints', path);
  return emitted;
};

afterEach(() => {
  while (managers.length > 0) {
    managers.pop()?.stop();
  }
});

test('caps long nav paths to 300 poses and keeps the endpoints', () => {
  const emitted = emitWaypoints(createManager(), makePath(1000));

  expect(emitted.poses.length).toBeLessThanOrEqual(300);
  expect(emitted.poses[0].pose.position).toEqual({ x: 0, y: 0, z: 0 });
  expect(emitted.poses.at(-1).pose.position).toEqual({ x: 999, y: 1998, z: 0 });
  const xs = emitted.poses.map((p: any) => p.pose.position.x);
  expect([...xs].sort((a, b) => a - b)).toEqual(xs);
});

test('leaves short nav paths untouched', () => {
  const emitted = emitWaypoints(createManager(), makePath(5));

  expect(emitted.poses.map((p: any) => p.pose.position.x)).toEqual([0, 1, 2, 3, 4]);
});
