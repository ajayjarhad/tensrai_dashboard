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

afterEach(() => {
  while (managers.length > 0) {
    managers.pop()?.stop();
  }
});

test('rejects map-to-odom plus odom topic pose when it diverges far from AMCL', () => {
  const manager = createManager();

  manager.mapPose = { x: -111.88421059791425, y: 159.7770146994187, yaw: 0 };
  manager.mapToOdom = {
    x: -361.59706034969054,
    y: 235.97354353346963,
    yaw: 0,
    stampMs: 1780761541203.9036,
  };
  manager.odomPose = {
    x: 203.19071563736748,
    y: -48.4762139442713,
    yaw: 0,
    stampMs: 1780761541203.9036,
  };

  const resolved = manager.computeMapBasePose();

  expect(resolved).toEqual({
    pose: { x: -111.88421059791425, y: 159.7770146994187, yaw: 0 },
    source: 'amcl',
  });
});

test('keeps map-to-odom plus odom topic pose when AMCL is unavailable', () => {
  const manager = createManager();

  manager.mapToOdom = { x: 10, y: 20, yaw: 0.1, stampMs: 1000 };
  manager.odomPose = { x: 2, y: 3, yaw: 0.2, stampMs: 1000 };

  const resolved = manager.computeMapBasePose();

  expect(resolved).toEqual({
    pose: { x: 11.690508080615567, y: 23.184679329127733, yaw: 0.30000000000000004 },
    source: 'tf:map->odom + odom topic',
    stampMs: 1000,
  });
});

test('keeps map-to-odom plus odom topic pose when it agrees with AMCL', () => {
  const manager = createManager();

  manager.mapPose = { x: 11.8, y: 23.1, yaw: 0.25 };
  manager.mapToOdom = { x: 10, y: 20, yaw: 0.1, stampMs: 1000 };
  manager.odomPose = { x: 2, y: 3, yaw: 0.2, stampMs: 1000 };

  const resolved = manager.computeMapBasePose();

  expect(resolved).toEqual({
    pose: { x: 11.690508080615567, y: 23.184679329127733, yaw: 0.30000000000000004 },
    source: 'tf:map->odom + odom topic',
    stampMs: 1000,
  });
});

test('keeps full TF pose ahead of AMCL even when AMCL disagrees', () => {
  const manager = createManager();

  manager.mapPose = { x: -111, y: 159, yaw: 0 };
  manager.mapToOdom = { x: 10, y: 20, yaw: 0.1, stampMs: 1000 };
  manager.odomToBase = { x: 2, y: 3, yaw: 0.2, stampMs: 1000 };
  manager.odomPose = { x: 203, y: -48, yaw: 0, stampMs: 1000 };

  const resolved = manager.computeMapBasePose();

  expect(resolved).toEqual({
    pose: { x: 11.690508080615567, y: 23.184679329127733, yaw: 0.30000000000000004 },
    source: 'tf:map->odom + odom->base',
    stampMs: 1000,
  });
});
