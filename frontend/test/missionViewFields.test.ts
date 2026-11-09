import { describe, expect, test } from 'bun:test';
import type { MissionStatus } from '@tensrai/shared';
import type { MissionRunRecord } from '@/features/robot-map/api/getMissionRuns';
import type { MissionWithContext } from '@/features/robot-map/types';
import { buildOngoingMissions, toMissionLogs } from '@/features/robot-map/utils/missionViews';
import { type Robot, RobotMode } from '@/types/robot';

const run = (extra: Partial<MissionRunRecord>): MissionRunRecord => ({
  id: 'run-1',
  robotId: 'r1',
  robotNameSnapshot: 'R1',
  status: 'COMPLETED',
  phase: 'completed',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-03T00:00:00.000Z',
  ...extra,
});

describe('toMissionLogs fields', () => {
  test('the end time falls back from endedAt to lastEventAt to updatedAt', () => {
    const logs = toMissionLogs([
      run({ id: 'ended', endedAt: '2026-01-01T00:00:00.000Z' }),
      run({ id: 'event', lastEventAt: '2026-01-02T00:00:00.000Z' }),
      run({ id: 'updated' }),
    ]);

    expect(logs.map(log => log.endedAt)).toEqual([
      Date.parse('2026-01-01T00:00:00.000Z'),
      Date.parse('2026-01-02T00:00:00.000Z'),
      Date.parse('2026-01-03T00:00:00.000Z'),
    ]);
  });

  test('optional fields are copied only when the run has them', () => {
    const [full, bare] = toMissionLogs([
      run({
        missionId: 'm1',
        startedAt: '2026-01-02T00:00:00.000Z',
        durationMs: 0,
        waypointIndex: 2,
        totalWaypoints: 4,
        lastMessage: 'done',
      }),
      run({ status: 'FAILED', waypointIndex: null, lastMessage: '' }),
    ]);

    expect(full).toStrictEqual({
      id: 'run-1',
      robotId: 'r1',
      robotName: 'R1',
      missionId: 'm1',
      missionName: 'Mission m1',
      result: 'completed',
      startedAt: Date.parse('2026-01-02T00:00:00.000Z'),
      endedAt: Date.parse('2026-01-03T00:00:00.000Z'),
      durationMs: 0,
      waypointIndex: 2,
      totalWaypoints: 4,
      message: 'done',
    });
    expect(bare).toStrictEqual({
      id: 'run-1',
      robotId: 'r1',
      robotName: 'R1',
      missionName: 'Mission',
      result: 'failed',
      endedAt: Date.parse('2026-01-03T00:00:00.000Z'),
    });
  });
});

describe('buildOngoingMissions fields', () => {
  const robot = (id: string, mapId?: string): Robot => ({
    id,
    name: id.toUpperCase(),
    status: RobotMode.AUTONOMOUS,
    ...(mapId ? { mapId } : {}),
    lastSeen: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  const patrol: MissionWithContext = {
    id: 'm1',
    name: 'Patrol',
    steps: ['a', 'b', 'c'],
    mapId: 'map-b',
    mapName: 'Warehouse',
    locationTags: [],
    availableRobots: [],
  };

  const rowsFor = (
    robots: Robot[],
    missionStatusByRobot: Record<string, MissionStatus>,
    pendingRobotIds: string[] = []
  ) =>
    buildOngoingMissions({
      robots,
      missionStatusByRobot,
      pendingMissionStarts: Object.fromEntries(
        pendingRobotIds.map(robotId => [robotId, { robotId, mission: patrol }])
      ),
      resolveMissionContext: missionId => (missionId === 'm1' ? patrol : null),
      mapNameById: { 'map-a': 'Floor 1' },
      selectedRobotId: null,
    });

  test('a resolved mission supplies the map, name and waypoint total', () => {
    const now = Date.now();
    const [row] = rowsFor([robot('r1', 'map-a')], {
      r1: {
        status: 'running',
        phase: 'running',
        currentMissionId: 'm1',
        waypointIndex: 0,
        startedAt: '2026-01-02T00:00:00.000Z',
        updatedAt: now - 5,
        lastSeenTs: now,
        message: 'on the way',
      },
    });

    expect(row).toStrictEqual({
      robotId: 'r1',
      robotName: 'R1',
      mapId: 'map-b',
      mapName: 'Warehouse',
      missionId: 'm1',
      missionName: 'Patrol',
      status: 'running',
      waypointIndex: 1,
      totalWaypoints: 3,
      startedAt: Date.parse('2026-01-02T00:00:00.000Z'),
      updatedAt: now - 5,
      lastSeenTs: now,
      message: 'on the way',
    });
  });

  test('an unknown mission falls back to the robot map and a generic name', () => {
    const now = Date.now();
    const [row] = rowsFor(
      [robot('r1', 'map-a')],
      {
        r1: {
          status: 'start_pending',
          phase: 'start_pending',
          lastEventMissionId: 'm9',
          startedAt: 'not a date',
          lastSeenTs: now,
        },
      },
      ['r1']
    );

    expect(row).toStrictEqual({
      robotId: 'r1',
      robotName: 'R1',
      mapId: 'map-a',
      mapName: 'Floor 1',
      missionId: 'm9',
      missionName: 'Mission m9',
      status: 'showing',
      lastSeenTs: now,
    });
  });

  test('a robot without a map or mission id gets only the required fields', () => {
    const now = Date.now();
    const [row] = rowsFor([robot('r1')], {
      r1: { status: 'paused', phase: 'paused', updatedAt: now, message: '' },
    });

    expect(row).toStrictEqual({
      robotId: 'r1',
      robotName: 'R1',
      missionName: 'Mission',
      status: 'paused',
      updatedAt: now,
    });
  });
});
