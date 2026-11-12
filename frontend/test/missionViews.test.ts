import { describe, expect, test } from 'bun:test';
import type { MissionStatus } from '@tensrai/shared';
import { missionIsFresh, toDisplayWaypointIndex } from '@/features/robot-map/utils/missionRuntime';
import { buildOngoingMissions, toMissionLogs } from '@/features/robot-map/utils/missionViews';
import { type Robot, RobotMode } from '@/types/robot';

const NOW = 1_000_000;

const status = (phase: MissionStatus['phase'], extra: Partial<MissionStatus> = {}) =>
  ({ phase, lastSeenTs: NOW, currentMissionId: 'm1', ...extra }) as MissionStatus;

const robot = (id: string, name: string) =>
  ({ id, name, status: RobotMode.AUTONOMOUS, mapId: 'map' }) as Robot;

const ongoing = (
  robots: Robot[],
  missionStatusByRobot: Record<string, MissionStatus>,
  selectedRobotId: string | null = null,
  pendingMissionStarts = {}
) =>
  buildOngoingMissions({
    robots,
    missionStatusByRobot,
    pendingMissionStarts,
    resolveMissionContext: () => null,
    mapNameById: {},
    selectedRobotId,
  });

describe('missionIsFresh', () => {
  test('preview phases go stale after 30 seconds, others after two minutes', () => {
    const ranThirtyOneSecondsAgo = { lastSeenTs: NOW - 31_000 };
    expect(missionIsFresh(status('showing', ranThirtyOneSecondsAgo), NOW)).toBe(false);
    expect(missionIsFresh(status('running', ranThirtyOneSecondsAgo), NOW)).toBe(true);
    expect(missionIsFresh(status('running', { lastSeenTs: NOW - 121_000 }), NOW)).toBe(false);
  });

  test('a status with no timestamp is never fresh', () => {
    expect(missionIsFresh(undefined, NOW)).toBe(false);
  });
});

test('toDisplayWaypointIndex is one-based and capped at the total', () => {
  expect(toDisplayWaypointIndex(0, 3)).toBe(1);
  expect(toDisplayWaypointIndex(9, 3)).toBe(3);
  expect(toDisplayWaypointIndex(undefined, 3)).toBeUndefined();
});

test('toMissionLogs keeps finished runs and reports unknown termination as failed', () => {
  const run = (id: string, runStatus: string) =>
    ({
      id,
      robotId: 'r',
      robotNameSnapshot: 'R',
      status: runStatus,
      updatedAt: '2026-01-01',
    }) as never;

  const logs = toMissionLogs([
    run('a', 'COMPLETED'),
    run('b', 'RUNNING'),
    run('c', 'UNKNOWN_TERMINATION'),
  ]);

  expect(logs.map(log => [log.id, log.result])).toEqual([
    ['a', 'completed'],
    ['c', 'failed'],
  ]);
});

describe('buildOngoingMissions', () => {
  const realNow = Date.now;
  const atNow = <T>(work: () => T) => {
    Date.now = () => NOW;
    try {
      return work();
    } finally {
      Date.now = realNow;
    }
  };

  test('sorts the selected robot first, then running before paused, then by name', () => {
    const rows = atNow(() =>
      ongoing(
        [robot('a', 'Alpha'), robot('b', 'Beta'), robot('c', 'Gamma'), robot('d', 'Delta')],
        {
          a: status('paused'),
          b: status('running'),
          c: status('paused'),
          d: status('running'),
        },
        'c'
      )
    );

    expect(rows.map(row => row.robotName)).toEqual(['Gamma', 'Beta', 'Delta', 'Alpha']);
  });

  test('hides a preview no one on this dashboard asked for', () => {
    const robots = [robot('a', 'Alpha')];
    const showing = { a: status('showing') };

    expect(atNow(() => ongoing(robots, showing))).toEqual([]);
    const pending = { a: { robotId: 'a', mission: {} } };
    expect(atNow(() => ongoing(robots, showing, null, pending))).toHaveLength(1);
  });

  test('leaves out idle robots and stale missions', () => {
    const rows = atNow(() =>
      ongoing([robot('a', 'Alpha'), robot('b', 'Beta')], {
        a: status('idle'),
        b: status('running', { lastSeenTs: NOW - 121_000 }),
      })
    );

    expect(rows).toEqual([]);
  });
});
