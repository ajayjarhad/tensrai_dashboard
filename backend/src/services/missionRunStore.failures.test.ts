import { expect, test } from 'bun:test';
import type { PrismaClient } from '@prisma/client';
import { MissionRunStore } from './missionRunStore.js';

const meta = { robotId: 'robot-1', robotName: 'R1' };
const writeFailed = new Error('write failed');

const runningRun = () => ({
  id: 'run-1',
  robotId: 'robot-1',
  status: 'RUNNING',
  phase: 'RUNNING',
  runId: 'rid-1',
  requestIdLast: 'req-1',
  startedAt: new Date(),
  updatedAt: new Date(),
});

// Every write fails, so each case shows whether the store logs a failure or hands it back.
const createStore = (current: object | null) => {
  const errors: unknown[][] = [];
  const queries: unknown[] = [];
  const log = { error: (...args: unknown[]) => errors.push(args), warn: () => {} };
  const prisma = {
    robot: { findUnique: async () => ({ orgId: 'org-1' }) },
    robotMap: { findMany: async () => [] },
    missionRun: {
      findUnique: async () => null,
      findFirst: async () => current,
      findMany: async (args: unknown) => {
        queries.push(args);
        return [];
      },
      create: async () => {
        throw writeFailed;
      },
      update: async () => {
        throw writeFailed;
      },
    },
  };
  // Only the delegates the store calls are faked.
  const store = new MissionRunStore(prisma as unknown as PrismaClient, log);
  return { store, errors, queries };
};

const logged = (event: string) => [
  [{ robotId: 'robot-1', event, error: writeFailed }, 'Failed to persist mission event'],
];

test('a failed write for a completed mission is logged and dropped', async () => {
  const { store, errors } = createStore(runningRun());

  const result = await store.applyEvent(meta, 'MISSION_COMPLETED', {
    runId: 'rid-1',
    status: 'success',
  });

  expect(result).toBeNull();
  expect(errors).toEqual(logged('MISSION_COMPLETED'));
});

test('a failed run created from a start ack is logged and dropped', async () => {
  const { store, errors } = createStore(null);

  const result = await store.applyEvent(meta, 'MISSION_START_ACK', {
    status: 'success',
    missionId: 'm1',
    requestId: 'req-2',
  });

  expect(result).toBeNull();
  expect(errors).toEqual(logged('MISSION_START_ACK'));
});

test('a failed close of a run the robot reports idle is logged and dropped', async () => {
  const { store, errors } = createStore(runningRun());

  const result = await store.applyEvent(meta, 'ROBOT_STATUS_UPDATE', {
    mission: { status: 'IDLE' },
  });

  expect(result).toBeNull();
  expect(errors).toEqual(logged('ROBOT_STATUS_UPDATE'));
});

test('failed updates for waypoint, pause, start and status reports reach the caller', async () => {
  const cases: [string, object][] = [
    ['WAYPOINT_ACK', { runId: 'rid-1', waypointIndex: 2 }],
    ['MISSION_CONTROL_ACK', { requestType: 'PAUSE', status: 'success' }],
    ['MISSION_START_ACK', { status: 'failure', requestId: 'req-1' }],
    ['ROBOT_STATUS_UPDATE', { mission: { status: 'ACTIVE', currentMissionId: 'm1' } }],
  ];
  for (const [event, payload] of cases) {
    const { store, errors } = createStore(runningRun());

    await expect(store.applyEvent(meta, event, payload)).rejects.toBe(writeFailed);
    expect(errors).toEqual([]);
  }
});

test('failed intent writes are logged under their own messages and dropped', async () => {
  const preview = createStore(null);
  expect(await preview.store.recordCommandIntent(meta, 'SHOW_UP', { missionId: 'm1' })).toBeNull();
  expect(preview.errors).toEqual([
    [
      { robotId: 'robot-1', event: 'SHOW_UP', error: writeFailed },
      'Failed to record mission intent',
    ],
  ]);

  const start = createStore({ ...runningRun(), status: 'SHOWING', phase: 'SHOWING' });
  expect(
    await start.store.recordCommandIntent(meta, 'START_MISSION', { missionId: 'm1' })
  ).toBeNull();
  expect(start.errors).toEqual([
    [
      { robotId: 'robot-1', event: 'START_MISSION', error: writeFailed },
      'Failed to persist start intent',
    ],
  ]);
});

test('listing runs maps each status filter, ignoring case and unknown names', async () => {
  const { store, queries } = createStore(null);
  const statusFilter = async (status: string) => {
    await store.listRuns({ status });
    return (queries.at(-1) as { where: Record<string, unknown> }).where['status'];
  };

  expect(await statusFilter('Active')).toEqual({
    in: ['PREVIEW_PENDING', 'SHOWING', 'START_PENDING', 'RUNNING', 'PAUSED'],
  });
  expect(await statusFilter('completed')).toBe('COMPLETED');
  expect(await statusFilter('FAILED')).toEqual({ in: ['FAILED', 'UNKNOWN_TERMINATION'] });
  expect(await statusFilter('cancelled')).toBe('CANCELLED');
  expect(await statusFilter('constructor')).toBeUndefined();
  expect(await statusFilter('running')).toBeUndefined();

  await store.listRuns({ orgId: 'org-1', robotId: 'robot-1', limit: 500 });
  expect(queries.at(-1)).toEqual({
    where: { orgId: 'org-1', robotId: 'robot-1' },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  });
});
