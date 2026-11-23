import { expect, test } from 'bun:test';
import type { MissionStatus } from '@tensrai/shared';
import { describeFleet } from '@/features/robot-map/utils/fleetEmergency';
import { mergeFleetRobots } from '@/features/robot-map/utils/missionRuntime';
import { type Robot, RobotMode } from '@/types/robot';

const robot = (name: string, overrides: Partial<Robot> = {}): Robot =>
  ({ id: name, name, status: RobotMode.AUTONOMOUS, ipAddress: '10.0.0.1', ...overrides }) as Robot;

const connected = (active: { software?: boolean; hardware?: boolean } = {}) =>
  ({
    connectionStatus: 'connected',
    softwareEmergencyActive: Boolean(active.software),
    hardwareEmergencyActive: Boolean(active.hardware),
    effectiveEmergencyActive: Boolean(active.software || active.hardware),
  }) as Robot['emergency'];

// Readings arrive through the same merge the header uses, which marks them live.
const withReadings = (robots: Robot[], readings: Record<string, Robot['emergency']>) =>
  mergeFleetRobots(robots, {}, readings);

test('a quiet fleet reads as the count online and nothing else', () => {
  const robots = withReadings([robot('A'), robot('B')], { A: connected(), B: connected() });

  expect(describeFleet(robots)).toEqual({ online: '2 robots online', stopped: null });
});

test('a stopped robot is named, and the online count stays', () => {
  const robots = withReadings([robot('A'), robot('Tensrai3')], {
    A: connected(),
    Tensrai3: connected({ software: true }),
  });

  expect(describeFleet(robots)).toEqual({ online: '2 online', stopped: '1 stopped: Tensrai3' });
});

test('a robot the API reports stopped counts even while its e-stop bridge is down', () => {
  const robots = [robot('Night shift', { status: RobotMode.HW_EMERGENCY })];

  expect(describeFleet(robots).stopped).toBe('1 stopped: Night shift');
});

test('the shared merge lets a fresh mission status override the API status', () => {
  const now = 1_000_000;
  const mission = {
    phase: 'running',
    mode: 'autonomous',
    lastSeenTs: now - 1_000,
  } as MissionStatus;

  const [merged] = mergeFleetRobots(
    [robot('A', { status: RobotMode.SW_EMERGENCY })],
    { A: mission },
    {},
    now
  );

  expect(merged?.status).toBe(RobotMode.MISSION);
});

test('the e-stop bridge reading lands on top of the mission merge', () => {
  const [merged] = mergeFleetRobots(
    [robot('A')],
    {},
    { A: connected({ hardware: true }) },
    1_000_000
  );

  expect(merged?.emergency?.hardwareEmergencyActive).toBe(true);
});
