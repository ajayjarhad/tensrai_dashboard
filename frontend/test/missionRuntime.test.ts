import { expect, test } from 'bun:test';
import type { MissionStatus } from '@tensrai/shared';
import { mergeMissionRuntimeIntoRobot } from '@/features/robot-map/utils/missionRuntime';
import { type Robot, RobotMode } from '@/types/robot';

const NOW = 1_000_000;

const robot: Robot = {
  id: 'r1',
  name: 'R1',
  status: RobotMode.AUTONOMOUS,
  battery: 50,
  lastSeen: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const mission = (extra: Partial<MissionStatus>): MissionStatus => ({
  status: 'running',
  phase: 'running',
  lastSeenTs: NOW,
  ...extra,
});

test('without a mission status the robot is returned untouched', () => {
  expect(mergeMissionRuntimeIntoRobot(robot, undefined, NOW)).toBe(robot);
});

test('a live mission takes over status, battery, runtime fields and waypoint progress', () => {
  const merged = mergeMissionRuntimeIntoRobot(
    robot,
    mission({
      mode: 'autonomous',
      batteryPercentage: 80,
      chargingStatus: 'charging',
      waypointIndex: 2,
      totalWaypoints: 5,
    }),
    NOW
  );

  expect(merged).toStrictEqual({
    ...robot,
    status: RobotMode.MISSION,
    lastSeen: new Date(NOW).toISOString(),
    battery: 80,
    runtimeMode: 'autonomous',
    runtimeBatteryPercentage: 80,
    runtimeChargingStatus: 'charging',
    runtimeLastSeenTs: NOW,
    waypointIndex: 2,
    totalWaypoints: 5,
  });
});

test('a fresh idle status reports the mode but leaves waypoint progress alone', () => {
  const merged = mergeMissionRuntimeIntoRobot(
    robot,
    mission({ phase: 'idle', status: 'idle', mode: 'teleop', waypointIndex: 1, totalWaypoints: 4 }),
    NOW
  );

  expect(merged).toStrictEqual({
    ...robot,
    status: RobotMode.TELEOP,
    lastSeen: new Date(NOW).toISOString(),
    runtimeMode: 'teleop',
    runtimeLastSeenTs: NOW,
  });
});

test('a stale status only refreshes lastSeen', () => {
  const staleTs = NOW - 121_000;
  const merged = mergeMissionRuntimeIntoRobot(
    robot,
    mission({ lastSeenTs: staleTs, batteryPercentage: 10, mode: 'teleop', waypointIndex: 3 }),
    NOW
  );

  expect(merged).toStrictEqual({ ...robot, lastSeen: new Date(staleTs).toISOString() });
});

test('a null battery reading keeps the stored battery but records the null runtime value', () => {
  const merged = mergeMissionRuntimeIntoRobot(
    robot,
    mission({ phase: 'idle', status: 'idle', batteryPercentage: null }),
    NOW
  );

  expect(merged.battery).toBe(50);
  expect(merged.runtimeBatteryPercentage).toBeNull();
});

test('a non-finite battery reading falls back to the stored battery', () => {
  const merged = mergeMissionRuntimeIntoRobot(
    robot,
    mission({ phase: 'idle', status: 'idle', batteryPercentage: Number.NaN }),
    NOW
  );

  expect(merged.battery).toBe(50);
  expect(merged.runtimeBatteryPercentage).toBeNaN();
});
