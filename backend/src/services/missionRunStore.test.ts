import { expect, test } from 'bun:test';
import { MissionRunStore } from './missionRunStore.js';

const log = { error: () => {}, warn: () => {} };
const meta = { robotId: 'robot-1', robotName: 'R1' };
const at = () => new Date().toISOString();

const createStore = () => {
  const runs: any[] = [];
  const matches = (run: any, where: any) =>
    Object.entries(where).every(([key, value]: [string, any]) =>
      value?.in ? value.in.includes(run[key]) : run[key] === value
    );
  const latest = (rows: any[]) => rows[rows.length - 1] ?? null;
  const prisma: any = {
    robot: { findUnique: async () => ({ orgId: 'org-1' }) },
    robotMap: {
      findMany: async () => [
        { mapId: 'map-a', isActive: true, map: { features: { missions: [] } } },
        {
          mapId: 'map-b',
          isActive: false,
          map: { features: { missions: [{ id: '1', name: ' Trial ' }] } },
        },
      ],
    },
    missionRun: {
      findUnique: async ({ where }: any) => runs.find(run => run.id === where.id) ?? null,
      findFirst: async ({ where }: any) => latest(runs.filter(run => matches(run, where))),
      create: async ({ data }: any) => {
        const run = { id: `run-${runs.length + 1}`, ...data, updatedAt: new Date() };
        runs.push(run);
        return run;
      },
      update: async ({ where, data }: any) => {
        const run = runs.find(entry => entry.id === where.id);
        Object.assign(run, data, { updatedAt: new Date() });
        return run;
      },
    },
  };
  return { store: new MissionRunStore(prisma, log), runs };
};

const idleStatus = () => ({
  timestamp: at(),
  mission: { status: 'IDLE', currentMissionId: null, runId: null },
});
const startAck = (status: string, requestId: string, runId: string | null) => ({
  status,
  missionId: 1,
  message: status === 'success' ? 'Loaded map map.yaml' : 'Mission already running',
  timestamp: at(),
  requestId,
  runId,
  startedAt: status === 'success' ? at() : null,
});
const controlAck = (requestType: string, message: string, requestId: string | null = null) => ({
  requestType,
  status: 'success',
  missionId: 1,
  message,
  timestamp: at(),
  requestId,
  runId: '1',
});

const preview = async (store: MissionRunStore) => {
  await store.recordCommandIntent(meta, 'SHOW_UP', { missionId: 1, requestId: 'show' });
  await store.applyEvent(
    meta,
    'MISSION_CONTROL_ACK',
    controlAck('SHOW_UP', 'Loaded map map.yaml', 'show')
  );
};
const startRunning = async (store: MissionRunStore) => {
  await preview(store);
  await store.recordCommandIntent(meta, 'START_MISSION', { missionId: 1, requestId: 'start' });
  await store.applyEvent(meta, 'MISSION_START_ACK', startAck('success', 'start', '1'));
};

test('the pause ack the robot really sends marks the run paused, with no requestId', async () => {
  const { store, runs } = createStore();
  await startRunning(store);
  await store.applyEvent(
    meta,
    'MISSION_CONTROL_ACK',
    controlAck('PAUSE_MISSION', 'Paused (Nav2 confirmed cancel)')
  );
  expect(runs[0].status).toBe('PAUSED');
  await store.applyEvent(
    meta,
    'MISSION_CONTROL_ACK',
    controlAck('RESUME_MISSION', 'Resuming with 3 remaining waypoints from 2/4')
  );
  expect(runs[0].status).toBe('RUNNING');
});

test('pause and resume acks carrying their own requestId still apply', async () => {
  const { store, runs } = createStore();
  await startRunning(store);
  await store.applyEvent(
    meta,
    'MISSION_CONTROL_ACK',
    controlAck('PAUSE_MISSION', 'Paused (no active goal)', 'pause-1')
  );
  expect(runs[0].status).toBe('PAUSED');
  await store.applyEvent(
    meta,
    'MISSION_CONTROL_ACK',
    controlAck('RESUME_MISSION', 'Resuming with 3 remaining waypoints from 2/4', 'resume-1')
  );
  expect(runs[0].status).toBe('RUNNING');
});

test('a late preview ack cannot overwrite a run that has moved on', async () => {
  const { store, runs } = createStore();
  await startRunning(store);
  await store.applyEvent(meta, 'MISSION_CONTROL_ACK', controlAck('SHOW_UP', 'Loaded', 'old-show'));
  expect(runs[0].status).toBe('RUNNING');
});

test('a cancel stays open until the robot completes it, and a status tick cannot split the run', async () => {
  const { store, runs } = createStore();
  await startRunning(store);
  await store.applyEvent(
    meta,
    'MISSION_CONTROL_ACK',
    controlAck('CANCEL_MISSION', 'Cancel requested', 'cancel-1')
  );
  expect(runs[0].status).toBe('RUNNING');
  await store.applyEvent(meta, 'ROBOT_STATUS_UPDATE', {
    timestamp: at(),
    mission: { status: 'ACTIVE', currentMissionId: 1, runId: '1' },
  });
  await store.applyEvent(meta, 'MISSION_COMPLETED', {
    missionId: 1,
    runId: '1',
    status: 'cancelled',
    completionTime: at(),
  });
  expect(runs).toHaveLength(1);
  expect(runs[0].status).toBe('CANCELLED');
});

test('a robot reporting IDLE does not end a preview, and the start then finds its run', async () => {
  const { store, runs } = createStore();
  await preview(store);
  await store.applyEvent(meta, 'ROBOT_STATUS_UPDATE', idleStatus());
  expect(runs[0].status).toBe('SHOWING');

  await store.recordCommandIntent(meta, 'START_MISSION', { missionId: 1, requestId: 'start' });
  await store.applyEvent(meta, 'ROBOT_STATUS_UPDATE', idleStatus());
  await store.applyEvent(meta, 'MISSION_START_ACK', startAck('success', 'start', '1'));
  expect(runs).toHaveLength(1);
  expect(runs[0].status).toBe('RUNNING');
  expect(runs[0].runId).toBe('1');
});

test('a run names its mission from whichever of the robot’s maps holds it', async () => {
  const { store, runs } = createStore();
  await preview(store);
  expect(runs[0]).toMatchObject({ mapId: 'map-b', missionNameSnapshot: 'Trial' });
});

test('a robot reporting IDLE still closes a run it has silently dropped', async () => {
  const { store, runs } = createStore();
  await startRunning(store);
  await store.applyEvent(meta, 'ROBOT_STATUS_UPDATE', idleStatus());
  expect(runs[0].status).toBe('UNKNOWN_TERMINATION');
});

test('a mission started with no live preview still gets a run', async () => {
  const { store, runs } = createStore();
  await store.recordCommandIntent(meta, 'START_MISSION', { missionId: 1, requestId: 'start' });
  await store.applyEvent(meta, 'MISSION_START_ACK', startAck('success', 'start', '1'));
  expect(runs).toHaveLength(1);
  expect(runs[0]).toMatchObject({ status: 'RUNNING', orgId: 'org-1', runId: '1', missionId: '1' });

  await store.applyEvent(meta, 'MISSION_COMPLETED', {
    missionId: 1,
    runId: '1',
    status: 'success',
    completionTime: at(),
  });
  expect(runs[0].status).toBe('COMPLETED');
});

test('a start ack with no usable mission id creates nothing', async () => {
  const { store, runs } = createStore();
  await store.applyEvent(meta, 'MISSION_START_ACK', {
    ...startAck('success', 'junk', '1'),
    missionId: { $ne: null },
    runId: { $ne: '' },
  });
  expect(runs).toHaveLength(0);
});

test('a refused start leaves the live run running, even one created from a status tick', async () => {
  const { store, runs } = createStore();
  await store.applyEvent(meta, 'ROBOT_STATUS_UPDATE', {
    timestamp: at(),
    mission: { status: 'ACTIVE', currentMissionId: 1, runId: '1' },
  });
  expect(runs[0].status).toBe('RUNNING');
  await store.applyEvent(meta, 'MISSION_START_ACK', startAck('failure', 'second', null));
  expect(runs[0].status).toBe('RUNNING');
  expect(runs[0].runId).toBe('1');
});

test('a failed start during a preview goes back to showing', async () => {
  const { store, runs } = createStore();
  await preview(store);
  await store.recordCommandIntent(meta, 'START_MISSION', { missionId: 1, requestId: 'start' });
  await store.applyEvent(meta, 'MISSION_START_ACK', startAck('failure', 'start', null));
  expect(runs[0].status).toBe('SHOWING');
});

test('a restarted robot reusing runId 1 does not rewrite the old finished run', async () => {
  const { store, runs } = createStore();
  await startRunning(store);
  await store.applyEvent(meta, 'MISSION_COMPLETED', {
    missionId: 1,
    runId: '1',
    status: 'success',
    completionTime: at(),
  });
  const finishedAt = runs[0].endedAt;

  await store.applyEvent(meta, 'MISSION_START_ACK', startAck('success', 'after-restart', '1'));
  await store.applyEvent(meta, 'WAYPOINT_ACK', {
    missionId: 1,
    runId: '1',
    waypointIndex: 1,
    totalWaypoints: 4,
    status: 'success',
    time: at(),
  });
  await store.applyEvent(meta, 'MISSION_COMPLETED', {
    missionId: 1,
    runId: '1',
    status: 'failure',
    completionTime: at(),
  });

  expect(runs).toHaveLength(2);
  expect(runs[0]).toMatchObject({ status: 'COMPLETED', endedAt: finishedAt });
  expect(runs[1].status).toBe('FAILED');
});

test('a preview acked by a robot whose clock lags is still live, and one left alone expires', async () => {
  const { store, runs } = createStore();
  await store.recordCommandIntent(meta, 'SHOW_UP', { missionId: 1, requestId: 'q1' });
  const robotClock = new Date(Date.now() - 40_000).toISOString();
  await store.applyEvent(meta, 'MISSION_CONTROL_ACK', {
    ...controlAck('SHOW_UP', 'Showing'),
    missionId: 1,
    requestId: 'q1',
    timestamp: robotClock,
  });
  expect((await store.getCurrentRun(meta.robotId))?.status).toBe('SHOWING');

  (runs[0] as { updatedAt: Date }).updatedAt = new Date(Date.now() - 31_000);
  expect(await store.getCurrentRun(meta.robotId)).toBeNull();
});

test('the e-stop request ids the robot reuses on every run never reopen a finished run', async () => {
  const { store, runs } = createStore();
  const estopCycle = async (runId: string) => {
    const pause = controlAck(
      'PAUSE_MISSION',
      'Paused (Nav2 confirmed cancel)',
      'EMERGENCY_AUTO_PAUSE'
    );
    await store.applyEvent(meta, 'MISSION_CONTROL_ACK', { ...pause, runId });
    const resume = controlAck('RESUME_MISSION', 'Resuming from 2/4', 'EMERGENCY_AUTO_RESUME');
    await store.applyEvent(meta, 'MISSION_CONTROL_ACK', { ...resume, runId });
  };
  const complete = (runId: string) =>
    store.applyEvent(meta, 'MISSION_COMPLETED', {
      status: 'success',
      missionId: 1,
      runId,
      message: 'All waypoints completed',
      completionTime: at(),
    });

  await startRunning(store);
  await estopCycle('1');
  await complete('1');

  await store.recordCommandIntent(meta, 'SHOW_UP', { missionId: 1, requestId: 'show-2' });
  await store.applyEvent(
    meta,
    'MISSION_CONTROL_ACK',
    controlAck('SHOW_UP', 'Loaded map map.yaml', 'show-2')
  );
  await store.recordCommandIntent(meta, 'START_MISSION', { missionId: 1, requestId: 'start-2' });
  await store.applyEvent(meta, 'MISSION_START_ACK', startAck('success', 'start-2', '2'));
  await estopCycle('2');
  await complete('2');

  expect(runs.map(run => [run.runId, run.status])).toEqual([
    ['1', 'COMPLETED'],
    ['2', 'COMPLETED'],
  ]);
});
