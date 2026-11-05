// Missions: dashboard command -> backend -> robot -> acks -> dashboard + DB, with the real bridge's quirks.
import {
  backendLogs,
  call,
  check,
  ctl,
  finish,
  mongoJson,
  note,
  openSocket,
  section,
  sleep,
  state,
  stats,
  waitFor,
} from './e2e-lib';

const { acmeOp, beta, a1, b1, acmeOrg, betaOrg } = state;

const runsFor = async (robotId: string, cookie = acmeOp.cookie) =>
  (await call(`/api/mission-runs?robotId=${robotId}&limit=50`, { cookie })).json?.data ?? [];
const current = async (robotId: string, cookie = acmeOp.cookie) =>
  (await call(`/api/robots/${robotId}/current-mission`, { cookie })).json?.data;
const cmd = (event: string, payload: object, commandId: string) => ({
  type: 'command',
  event,
  commandId,
  payload,
});
const preview = async (m: any, id: string) => {
  m.send(cmd('SHOW_UP', { missionId: 1 }, `preview-${id}`));
  await m.waitEvent('MISSION_CONTROL_ACK', (p: any) => p.requestId === `preview-${id}`);
};

section('robot status');
const m = await openSocket(`/ws/robots/${a1}/mapping/e2e`, acmeOp.cookie);
await ctl('a1', '/reset');
await ctl('a1', '/status');
const status = await m.waitEvent('ROBOT_STATUS_UPDATE');
check('the robot’s status reaches the dashboard', status, m.received.slice(0, 3));
note(`robot says robotId=${(status as any)?.payload?.robotId} (hardcoded on real robots)`);
const robotRow = () => call(`/api/robots/${a1}`, { cookie: acmeOp.cookie }).then(r => r.json?.data);
check(
  'battery from the status is stored',
  await waitFor(async () => (await robotRow())?.battery === 80),
  await robotRow()
);
await ctl('a1', '/battery?v=42.5');
await ctl('a1', '/status');
check(
  'battery changes follow the robot',
  await waitFor(async () => (await robotRow())?.battery === 42.5),
  await robotRow()
);
const bRow = await call(`/api/robots/${b1}`, { cookie: beta.cookie });
check(
  'another robot with the same hardcoded robotId:1 is unaffected',
  bRow.json?.data?.battery !== 42.5,
  bRow.json?.data?.battery
);
await ctl('a1', '/battery?v=null');
await ctl('a1', '/status');
await sleep(300);
check('a null battery is not an error', (await m.events('ROBOT_STATUS_UPDATE').length) >= 2);
await ctl('a1', '/battery?v=80');

section('mode change');
m.clear();
m.send(cmd('CHANGE_MODE', { targetMode: 'teleopActive' }, 'mode-1'));
const toTeleop = (await m.waitEvent('MODE_CHANGE_ACK')) as any;
check(
  'CHANGE_MODE teleop acks',
  toTeleop?.payload?.status === 'success' && toTeleop?.payload?.currentMode === 'teleop',
  toTeleop
);
check('the robot actually got it', (await stats('a1')).state.mode === 'teleop');
m.clear();
m.send(cmd('CHANGE_MODE', { targetMode: 'hyperdrive' }, 'mode-2'));
const badMode = (await m.waitEvent('MODE_CHANGE_ACK')) as any;
check(
  'an unknown mode fails with the robot’s error',
  badMode?.payload?.error === 'unknown_targetMode',
  badMode
);
m.clear();
m.send(cmd('CHANGE_MODE', { targetMode: 'autonomousActive' }, 'mode-3'));
await m.waitEvent('MODE_CHANGE_ACK');

section('SHOW_UP');
m.clear();
m.send(cmd('SHOW_UP', { missionId: 1 }, 'show-1'));
const shown = (await m.waitEvent('MISSION_CONTROL_ACK', p => p.requestType === 'SHOW_UP')) as any;
check(
  'SHOW_UP acks success with the requestId',
  shown?.payload?.status === 'success' && shown?.payload?.requestId === 'show-1',
  shown
);
m.clear();
m.send(cmd('SHOW_UP', { missionId: 999 }, 'show-2'));
const unknownShow = (await m.waitEvent('MISSION_CONTROL_ACK', p => p.status === 'failure')) as any;
check(
  'SHOW_UP of an unknown mission fails',
  /No metadata/.test(unknownShow?.payload?.message ?? ''),
  unknownShow
);

section('full mission: start -> waypoints -> completed');
m.clear();
const _before = (await runsFor(a1)).length;
await preview(m, '1');
await ctl('a1', '/status');
await sleep(300);
const previewRun = await current(a1);
check(
  'a robot reporting IDLE does not end the preview',
  previewRun?.status === 'SHOWING',
  previewRun
);
m.send(cmd('START_MISSION', { missionId: 1 }, 'start-1'));
const started = (await m.waitEvent('MISSION_START_ACK')) as any;
check(
  'START_MISSION acks with runId and startedAt',
  started?.payload?.status === 'success' && started?.payload?.runId && started?.payload?.startedAt,
  started
);
const runId = started?.payload?.runId;
const live = await waitFor(async () => {
  const c = await current(a1);
  return c?.runId === runId && c;
}, 2000);
check('current-mission shows the run', live, await current(a1));
note(`current-mission: ${JSON.stringify(live).slice(0, 300)}`);
check(
  'it is stamped with Acme',
  mongoJson(`db.MissionRun.find({robotId:ObjectId('${a1}'),runId:'${runId}'}).toArray()`).every(
    (r: any) => r.orgId?.$oid === acmeOrg
  ),
  'orgId'
);
m.send(cmd('START_MISSION', { missionId: 1 }, 'start-dup'));
const dup = (await m.waitEvent('MISSION_START_ACK', p => p.status === 'failure')) as any;
check(
  'a second start is refused by the robot',
  dup?.payload?.message === 'Mission already running',
  dup
);
await sleep(400);
const liveAfterRefusal = await current(a1);
check(
  'the refused start did not break the live run',
  liveAfterRefusal?.runId === runId && liveAfterRefusal?.status === 'RUNNING',
  liveAfterRefusal
);
note(`run after refused start: ${JSON.stringify(await current(a1)).slice(0, 200)}`);
const wp = await waitFor(
  () => m.events('WAYPOINT_ACK').length >= 4 && m.events('WAYPOINT_ACK'),
  15000
);
check(
  'all four waypoint acks arrive in order',
  wp && (wp as any[]).map(e => e.payload.waypointIndex).join() === '1,2,3,4',
  m.events('WAYPOINT_ACK').map(e => e.payload.waypointIndex)
);
const done = (await m.waitEvent('MISSION_COMPLETED')) as any;
check('MISSION_COMPLETED success arrives', done?.payload?.status === 'success', done);
const finished = await waitFor(async () => {
  const run = (await runsFor(a1)).find((r: any) => r.runId === runId);
  return run && run.status === 'COMPLETED' && run;
}, 2000);
note(`stored run: ${JSON.stringify(finished).slice(0, 400)}`);
check(
  'the stored run finished as success',
  finished && /complet|success/i.test(String((finished as any).status)),
  finished
);
check('current-mission clears', await waitFor(async () => !(await current(a1))), await current(a1));

section('pause and resume: the bridge’s pause ack has NO requestId once a goal is live');
m.clear();
await preview(m, '2');
m.send(cmd('START_MISSION', { missionId: 1 }, 'start-2'));
const s2 = (await m.waitEvent('MISSION_START_ACK')) as any;
const run2 = s2?.payload?.runId;
await m.waitEvent('WAYPOINT_ACK', p => p.waypointIndex === 1);
m.send(cmd('PAUSE_MISSION', { missionId: 1 }, 'pause-1'));
const paused = (await m.waitEvent(
  'MISSION_CONTROL_ACK',
  p => p.requestType === 'PAUSE_MISSION'
)) as any;
check(
  'pause confirmed by the robot',
  paused?.payload?.message === 'Paused (Nav2 confirmed cancel)',
  paused
);
check('(and that ack really has no requestId)', paused?.payload?.requestId == null, paused);
const pausedRow = await waitFor(async () => {
  const c = await current(a1);
  return c?.status === 'PAUSED' && c;
});
check('the stored run shows paused', pausedRow, await current(a1));
const waypointsWhilePaused = m.events('WAYPOINT_ACK').length;
await sleep(2500);
check('no progress while paused', m.events('WAYPOINT_ACK').length === waypointsWhilePaused);
m.send(cmd('PAUSE_MISSION', { missionId: 1 }, 'pause-2'));
const again = (await m.waitEvent('MISSION_CONTROL_ACK', p => p.requestId === 'pause-2')) as any;
check('pausing again says already paused', again?.payload?.message === 'Already paused', again);
m.send(cmd('RESUME_MISSION', { missionId: 2 }, 'resume-wrong'));
const wrong = (await m.waitEvent(
  'MISSION_CONTROL_ACK',
  p => p.requestId === 'resume-wrong'
)) as any;
check(
  'resuming the wrong mission is refused',
  wrong?.payload?.message === 'missionId mismatch',
  wrong
);
check(
  'the failed resume keeps the run paused',
  (await current(a1))?.status === 'PAUSED',
  await current(a1)
);
m.send(cmd('RESUME_MISSION', { missionId: 1 }, 'resume-1'));
const resumed = (await m.waitEvent('MISSION_CONTROL_ACK', p => p.requestId === 'resume-1')) as any;
check(
  'resume says what is left',
  /Resuming with 3 remaining waypoints from 2\/4/.test(resumed?.payload?.message ?? ''),
  resumed
);
check(
  'the stored run is active again',
  await waitFor(async () => (await current(a1))?.status === 'RUNNING', 1000),
  await current(a1)
);
const completed2 = (await m.waitEvent('MISSION_COMPLETED', p => p.runId === run2)) as any;
check('the resumed mission completes', completed2?.payload?.status === 'success', completed2);

section('start with no preview (preview expired, or a second tab)');
m.clear();
m.send(cmd('START_MISSION', { missionId: 2 }, 'direct-1'));
const direct = (await m.waitEvent('MISSION_START_ACK')) as any;
check(
  'the run is recorded immediately',
  await waitFor(async () => (await current(a1))?.runId === direct?.payload?.runId, 2000),
  await current(a1)
);
const directDone = (await m.waitEvent(
  'MISSION_COMPLETED',
  p => p.runId === direct?.payload?.runId
)) as any;
check('a one-waypoint mission completes', directDone?.payload?.status === 'success', directDone);
check(
  'it stays in history as completed',
  await waitFor(
    async () =>
      (await runsFor(a1)).find(
        (r: any) => r.runId === direct?.payload?.runId && r.status === 'COMPLETED'
      ),
    3000
  ),
  (await runsFor(a1)).slice(0, 2)
);

section('cancel');
m.clear();
await preview(m, '3');
m.send(cmd('START_MISSION', { missionId: 1 }, 'start-3'));
const s3 = (await m.waitEvent('MISSION_START_ACK')) as any;
await m.waitEvent('WAYPOINT_ACK', p => p.waypointIndex === 1);
m.send(cmd('CANCEL_MISSION', { missionId: 1 }, 'cancel-1'));
const cancelAck = (await m.waitEvent(
  'MISSION_CONTROL_ACK',
  p => p.requestId === 'cancel-1'
)) as any;
check('cancel is acknowledged', cancelAck?.payload?.message === 'Cancel requested', cancelAck);
const cancelled = (await m.waitEvent(
  'MISSION_COMPLETED',
  p => p.runId === s3?.payload?.runId
)) as any;
check('cancel completes as cancelled', cancelled?.payload?.status === 'cancelled', cancelled);
const cancelledRow = await waitFor(async () =>
  (await runsFor(a1)).find((r: any) => r.runId === s3?.payload?.runId && /cancel/i.test(r.status))
);
check(
  'the stored run says cancelled',
  cancelledRow,
  (await runsFor(a1)).find((r: any) => r.runId === s3?.payload?.runId)
);
m.clear();
m.send(cmd('CANCEL_MISSION', {}, 'cancel-none'));
const noCancel = (await m.waitEvent(
  'MISSION_CONTROL_ACK',
  p => p.requestId === 'cancel-none'
)) as any;
check(
  'cancel with nothing running fails cleanly',
  noCancel?.payload?.message === 'No mission to cancel',
  noCancel
);

section('robot-side failure');
m.clear();
await ctl('a1', '/fail-next');
await preview(m, '4');
m.send(cmd('START_MISSION', { missionId: 1 }, 'start-4'));
const s4 = (await m.waitEvent('MISSION_START_ACK')) as any;
const failure = (await m.waitEvent(
  'MISSION_COMPLETED',
  p => p.runId === s4?.payload?.runId
)) as any;
check('a Nav2 failure completes as failure', failure?.payload?.status === 'failure', failure);
const failedRow = await waitFor(async () =>
  (await runsFor(a1)).find((r: any) => r.runId === s4?.payload?.runId && /fail/i.test(r.status))
);
check(
  'the stored run says failed',
  failedRow,
  (await runsFor(a1)).find((r: any) => r.runId === s4?.payload?.runId)
);

section('switching to teleop kills a running mission, as on the robot');
m.clear();
await preview(m, '5');
m.send(cmd('START_MISSION', { missionId: 1 }, 'start-5'));
const s5 = (await m.waitEvent('MISSION_START_ACK')) as any;
await m.waitEvent('WAYPOINT_ACK', p => p.waypointIndex === 1);
m.send(cmd('CHANGE_MODE', { targetMode: 'teleopActive' }, 'mode-4'));
const killed = (await m.waitEvent('MISSION_COMPLETED', p => p.runId === s5?.payload?.runId)) as any;
check('it ends as failure status=5', /status=5/.test(killed?.payload?.message ?? ''), killed);
m.send(cmd('CHANGE_MODE', { targetMode: 'autonomousActive' }, 'mode-5'));
await sleep(300);

section('e-stop during a mission: auto pause and auto resume');
const e = await openSocket(`/ws/robots/${a1}/emergency/e2e`, acmeOp.cookie);
const snapshot = (await e.waitEvent('EMERGENCY_STATE')) as any;
check(
  'emergency snapshot on connect',
  snapshot?.payload?.effectiveEmergencyActive === false,
  e.received
);
m.clear();
await preview(m, '6');
m.send(cmd('START_MISSION', { missionId: 1 }, 'start-6'));
const s6 = (await m.waitEvent('MISSION_START_ACK')) as any;
await m.waitEvent('WAYPOINT_ACK', p => p.waypointIndex === 1);
e.clear();
e.send({ event: 'SOFTWARE_EMERGENCY', payload: { status: true } });
const swAck = (await e.waitEvent('SOFTWARE_EMERGENCY_ACK')) as any;
check(
  'software e-stop acks with state',
  swAck?.payload?.status === true && swAck?.payload?.effectiveEmergencyActive === true,
  e.received
);
check(
  'state broadcast follows',
  await e.waitEvent('EMERGENCY_STATE', p => p.softwareEmergencyActive === true),
  e.received
);
const autoPause = (await m.waitEvent(
  'MISSION_CONTROL_ACK',
  p => p.requestType === 'PAUSE_MISSION'
)) as any;
check(
  'the robot pauses the mission itself',
  /Paused/.test(autoPause?.payload?.message ?? ''),
  autoPause
);
check(
  'the stored run shows paused',
  await waitFor(async () => (await current(a1))?.status === 'PAUSED'),
  await current(a1)
);
e.clear();
m.clear();
e.send({ event: 'SOFTWARE_EMERGENCY', payload: { status: false } });
await e.waitEvent('SOFTWARE_EMERGENCY_ACK');
const autoResume = (await m.waitEvent(
  'MISSION_CONTROL_ACK',
  p => p.requestId === 'EMERGENCY_AUTO_RESUME'
)) as any;
check(
  'release resumes it automatically',
  /Resuming/.test(autoResume?.payload?.message ?? ''),
  autoResume
);
const c6 = (await m.waitEvent('MISSION_COMPLETED', p => p.runId === s6?.payload?.runId)) as any;
check('and it completes', c6?.payload?.status === 'success', c6);

section('hardware e-stop');
e.clear();
m.clear();
await preview(m, '7');
m.send(cmd('START_MISSION', { missionId: 1 }, 'start-7'));
const s7 = (await m.waitEvent('MISSION_START_ACK')) as any;
await m.waitEvent('WAYPOINT_ACK', p => p.waypointIndex === 1);
await ctl('a1', '/hw?on=1');
const hw = (await e.waitEvent('HARDWARE_EMERGENCY_ACK')) as any;
check(
  'hardware e-stop reaches the dashboard',
  hw?.payload?.status === true && hw?.payload?.hardwareEmergencyActive === true,
  e.received
);
check(
  'state shows effective emergency',
  await e.waitEvent('EMERGENCY_STATE', p => p.hardwareEmergencyActive === true),
  e.received
);
await m.waitEvent('MISSION_CONTROL_ACK', p => p.requestType === 'PAUSE_MISSION');
e.send({ event: 'SOFTWARE_EMERGENCY', payload: { status: false } });
await sleep(300);
check(
  'releasing software does not release hardware',
  (await stats('a1')).state.mission.paused === true,
  (await stats('a1')).state
);
m.clear();
await ctl('a1', '/hw?on=0');
const hwResume = await m.waitEvent(
  'MISSION_CONTROL_ACK',
  p => p.requestId === 'EMERGENCY_AUTO_RESUME'
);
check('hardware release resumes', hwResume, m.received);
await m.waitEvent('MISSION_COMPLETED', p => p.runId === s7?.payload?.runId);

section('bad e-stop input');
e.clear();
e.send({ event: 'SOFTWARE_EMERGENCY', payload: { status: 'yes' } });
e.send({ event: 'SOMETHING_ELSE' });
e.send('not json');
await sleep(300);
check(
  'non-boolean status is refused before the robot',
  e.received.some(r => r.type === 'error' && /must be boolean/.test(r.message)),
  e.received
);
check('robot state did not change', (await stats('a1')).state.swEmergency === false);

section('mission input fuzz through the socket');
m.clear();
await ctl('a1', '/reset');
for (const raw of [
  'not json',
  { event: 'START_MISSION', payload: 'nope' },
  { event: 'START_MISSION', payload: { missionId: { $ne: 1 } } },
  { event: 'NOT_A_COMMAND' },
  { type: 'request', event: 'START_MISSION' },
  { event: 'PAUSE_MISSION', payload: null },
  [],
  null,
]) {
  m.send(typeof raw === 'string' ? raw : JSON.stringify(raw));
}
await sleep(800);
check('the socket survives bad commands', m.closeCode() === null, m.closeCode());
const runningNow = (await stats('a1')).state.mission.active;
note(
  `after fuzz: robot active=${runningNow}; robot received ${JSON.stringify((await stats('a1')).received.mission).slice(0, 300)}`
);
check('no mission started from junk', !runningNow, (await stats('a1')).state.mission);
check(
  'the mission list still loads',
  (await call('/api/mission-runs?limit=100', { cookie: acmeOp.cookie })).status === 200
);

section('tenant isolation of runs');
const betaRuns = await runsFor(b1, beta.cookie);
check('Beta sees none of Acme’s runs', betaRuns.length === 0, betaRuns);
const betaAsks = await call(`/api/mission-runs?robotId=${a1}`, { cookie: beta.cookie });
check(
  'Beta asking for Acme’s robot gets nothing',
  (betaAsks.json?.data ?? []).length === 0,
  betaAsks.json
);
const betaCurrent = await call(`/api/robots/${a1}/current-mission`, { cookie: beta.cookie });
check(
  'Beta’s current-mission on Acme’s robot is 404',
  betaCurrent.status === 404,
  betaCurrent.status
);
const audited = mongoJson(
  `db.AuditLog.countDocuments({action:'MISSION_COMMAND', orgId:ObjectId('${acmeOrg}')})`
);
check('mission commands are audited under Acme', audited >= 5, audited);
check(
  'and none under Beta',
  mongoJson(
    `db.AuditLog.countDocuments({action:'MISSION_COMMAND', orgId:ObjectId('${betaOrg}')})`
  ) === 0
);
const allRuns = mongoJson(`db.MissionRun.find({},{status:1,runId:1}).toArray()`);
note(
  `runs in DB: ${allRuns.length}: ${allRuns.map((r: any) => `${r.runId}:${r.status}`).join(' ')}`
);

const errors = backendLogs('4m')
  .split('\n')
  .filter(l => /Uncaught exception|Unhandled rejection|^Bun v1/.test(l));
check('no backend errors during missions', errors.length === 0, errors.slice(0, 3));
m.close();
e.close();
finish();
