// The robot's real Python bridges, through nginx, backend and database. rosbridge isn't part of this
// Python, so port 9090 is genuinely down here: the rest must work regardless.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  backendLogs,
  call,
  check,
  finish,
  mongoJson,
  note,
  openSocket,
  REPO,
  robotPorts,
  section,
  sh,
  sleep,
  state,
  waitFor,
} from './e2e-lib';

const { staff, acme, acmeOp, beta, acmeOrg } = state;
const real = async () => (await fetch('http://127.0.0.1:19004/stats')).json() as Promise<any>;
const hw = (on: number) => fetch(`http://127.0.0.1:19004/hw?on=${on}`);
const ip = sh([
  'docker',
  'inspect',
  '-f',
  '{{(index .NetworkSettings.Networks "dashboard-e2e_tensrai-network").IPAddress}}',
  'real-robot',
]).out.trim();
note(`real robot at ${ip}`);
const cmd = (event: string, payload: object, commandId: string) => ({
  type: 'command',
  event,
  commandId,
  payload,
});
const pgmHash = (name: string) =>
  createHash('sha256')
    .update(readFileSync(`${REPO}/dashboard_ros/maps/${name}`))
    .digest('hex');

section('onboarding the robot');
const created = await call('/api/robots', {
  cookie: acme.cookie,
  method: 'POST',
  body: { name: 'Real Python Robot', ipAddress: ip, ...robotPorts },
});
check(
  'saved and waiting for approval',
  created.json?.data?.addressStatus === 'PENDING',
  created.json
);
const id = created.json.data.id;
await sleep(1500);
check(
  'no connection before approval',
  Object.values((await real()).connections).every(n => n === 0),
  (await real()).connections
);
const pending = (
  await call('/api/staff/addresses?status=PENDING', { cookie: staff.cookie })
).json.data.find((a: any) => a.ip === ip);
check(
  'staff approve it',
  (
    await call(`/api/staff/addresses/${pending.id}/approve`, {
      cookie: staff.cookie,
      method: 'POST',
    })
  ).status === 200
);
check(
  'the backend connects to the real mission bridge',
  await waitFor(async () => (await real()).connections['9487'] === 1, 20000),
  (await real()).connections
);
check(
  'and the real emergency bridge',
  await waitFor(async () => (await real()).connections['8766'] === 1, 20000),
  (await real()).connections
);

const row = async () => (await call(`/api/robots/${id}`, { cookie: acmeOp.cookie })).json?.data;
check(
  'the real status update is accepted: battery',
  await waitFor(async () => (await row())?.battery === 80, 8000),
  await row()
);
note(
  `robot row: status=${(await row())?.status} battery=${(await row())?.battery} mission=${(await row())?.mission?.phase} mode=${(await row())?.mission?.mode}`
);
check(
  'its hardcoded robotId:1 touched no other robot',
  (await call('/api/robots', { cookie: beta.cookie })).status === 200
);

section('map sync from the real bridge');
const synced = await call(`/api/robots/${id}/map-sync`, { cookie: acmeOp.cookie, method: 'POST' });
check('sync starts', synced.status === 200, synced.json);
const ended = (await waitFor(async () => {
  const s = (await call(`/api/robots/${id}/map-sync`, { cookie: acmeOp.cookie })).json?.data;
  return ['complete', 'failed'].includes(s?.phase) && s;
}, 15000)) as any;
check('sync completes', ended?.phase === 'complete', ended);
const maps = (await call(`/api/robots/${id}/maps`, { cookie: acmeOp.cookie })).json?.data ?? [];
check('both real maps are linked', maps.length === 2, maps);
const active = maps.find((m: any) => m.isActive);
check('the real default map is active', active?.name === 'map', maps);
const image = await call(`/api/maps/${active?.id}/image`, { cookie: acmeOp.cookie, raw: true });
check(
  'stored image is byte-identical to the robot’s file',
  createHash('sha256').update(image.bytes).digest('hex') === pgmHash('map.pgm')
);
const detail = (await call(`/api/maps/${active?.id}`, { cookie: acmeOp.cookie })).json?.data;
check(
  'real metadata parsed: resolution, origin, tags, missions',
  detail?.metadata?.resolution === 0.05 &&
    detail?.features?.locationTags?.length === 4 &&
    detail?.features?.missions?.length === 2,
  detail?.metadata
);
check('display image generated', detail?.displayAssets?.webp === true, detail?.displayAssets);

section('mission through the real bridge');
const m = await openSocket(`/ws/robots/${id}/mapping/real`, acmeOp.cookie);
const current = async () =>
  (await call(`/api/robots/${id}/current-mission`, { cookie: acmeOp.cookie })).json?.data;
const runs = async () =>
  (await call(`/api/mission-runs?robotId=${id}&limit=50`, { cookie: acmeOp.cookie })).json?.data ??
  [];
m.send(cmd('SHOW_UP', { missionId: '1' }, 'show-1'));
const shown = (await m.waitEvent('MISSION_CONTROL_ACK', p => p.requestId === 'show-1')) as any;
check(
  'SHOW_UP answered with the requestId',
  shown?.payload?.status === 'success' && /map\.yaml/.test(shown?.payload?.message),
  shown
);
check(
  'preview stored with the mission’s name',
  await waitFor(async () => (await current())?.missionNameSnapshot === 'Mission Trial', 3000),
  await current()
);
m.send(cmd('START_MISSION', { missionId: '1' }, 'start-1'));
const started = (await m.waitEvent('MISSION_START_ACK', p => p.requestId === 'start-1')) as any;
check(
  'START acknowledged with a string runId',
  typeof started?.payload?.runId === 'string' && started?.payload?.status === 'success',
  started
);
check('robot really is active', (await real()).mission.active === true);
await m.waitEvent('WAYPOINT_ACK', p => p.waypointIndex === 1);
m.send(cmd('PAUSE_MISSION', { missionId: '1' }, 'pause-1'));
const paused = (await m.waitEvent(
  'MISSION_CONTROL_ACK',
  p => p.requestType === 'PAUSE_MISSION'
)) as any;
check(
  'real pause ack: Nav2 confirmed, no requestId',
  paused?.payload?.message === 'Paused (Nav2 confirmed cancel)' &&
    paused?.payload?.requestId == null,
  paused
);
check(
  'stored as paused',
  await waitFor(async () => (await current())?.status === 'PAUSED', 2000),
  await current()
);
m.send(cmd('RESUME_MISSION', { missionId: '1' }, 'resume-1'));
const resumed = (await m.waitEvent('MISSION_CONTROL_ACK', p => p.requestId === 'resume-1')) as any;
check(
  'real resume names what is left',
  /Resuming with 3 remaining waypoints from 2\/4/.test(resumed?.payload?.message ?? ''),
  resumed
);
check(
  'stored as running again',
  await waitFor(async () => (await current())?.status === 'RUNNING', 2000),
  await current()
);
const done = (await m.waitEvent(
  'MISSION_COMPLETED',
  p => p.runId === started?.payload?.runId,
  15000
)) as any;
check('completes as success', done?.payload?.status === 'success', done);
const stored = (await waitFor(
  async () =>
    (
      await runs()
    ).find((r: any) => r.runId === started?.payload?.runId && r.status === 'COMPLETED'),
  2000
)) as any;
check(
  'stored complete, 4 of 4, with its message',
  stored?.waypointIndex === 4 &&
    stored?.totalWaypoints === 4 &&
    stored?.lastMessage === 'All waypoints completed',
  stored
);
check(
  'stamped with the org',
  mongoJson(`db.MissionRun.findOne({_id:ObjectId('${stored?.id}')}).orgId`)?.$oid === acmeOrg
);

section('mission on the second real map');
m.clear();
m.send(cmd('SHOW_UP', { missionId: 3 }, 'show-3'));
const show3 = (await m.waitEvent('MISSION_CONTROL_ACK', p => p.requestId === 'show-3')) as any;
check('robot loads map1 for it', /map1\.yaml/.test(show3?.payload?.message ?? ''), show3);
check(
  'named from whichever map holds it',
  await waitFor(async () => (await current())?.missionNameSnapshot === 'upside_mission', 3000),
  await current()
);
m.send(cmd('START_MISSION', { missionId: 3 }, 'start-3'));
const s3 = (await m.waitEvent('MISSION_START_ACK', p => p.requestId === 'start-3')) as any;
await m.waitEvent('WAYPOINT_ACK', p => p.waypointIndex === 1);
m.send(cmd('CANCEL_MISSION', { missionId: 3 }, 'cancel-3'));
const c3 = (await m.waitEvent('MISSION_COMPLETED', p => p.runId === s3?.payload?.runId)) as any;
check(
  'real cancel: Nav2 confirmed',
  c3?.payload?.status === 'cancelled' && /Nav2 confirmed/.test(c3?.payload?.message ?? ''),
  c3
);
check(
  'stored cancelled',
  await waitFor(
    async () =>
      (await runs()).find((r: any) => r.runId === s3?.payload?.runId && r.status === 'CANCELLED'),
    2000
  ),
  (await runs())[0]
);

section('e-stop through the real emergency bridge');
const e = await openSocket(`/ws/robots/${id}/emergency/real`, acmeOp.cookie);
check(
  'real state on connect',
  await e.waitEvent('EMERGENCY_STATE', p => p.effectiveEmergencyActive === false)
);
m.clear();
m.send(cmd('SHOW_UP', { missionId: 1 }, 'show-e'));
await m.waitEvent('MISSION_CONTROL_ACK', p => p.requestId === 'show-e');
m.send(cmd('START_MISSION', { missionId: 1 }, 'start-e'));
const se = (await m.waitEvent('MISSION_START_ACK', p => p.requestId === 'start-e')) as any;
await m.waitEvent('WAYPOINT_ACK', p => p.waypointIndex === 1);
e.clear();
e.send({ event: 'SOFTWARE_EMERGENCY', payload: { status: true } });
check(
  'real software ack reaches the dashboard',
  await e.waitEvent('SOFTWARE_EMERGENCY_ACK', p => p.softwareEmergencyActive === true),
  e.received
);
check(
  'the real mission bridge pauses by itself',
  await m.waitEvent('MISSION_CONTROL_ACK', p => p.requestType === 'PAUSE_MISSION'),
  m.received.slice(-3)
);
check(
  'the robot record shows the e-stop',
  await waitFor(async () => (await row())?.status === 'SW_EMERGENCY', 4000),
  (await row())?.status
);
check(
  'stored as paused',
  await waitFor(async () => (await current())?.status === 'PAUSED', 2000),
  await current()
);
m.clear();
e.clear();
e.send({ event: 'SOFTWARE_EMERGENCY', payload: { status: false } });
check(
  'release resumes it: EMERGENCY_AUTO_RESUME',
  await m.waitEvent('MISSION_CONTROL_ACK', p => p.requestId === 'EMERGENCY_AUTO_RESUME'),
  m.received
);
check(
  'stored as running',
  await waitFor(async () => (await current())?.status === 'RUNNING', 2000),
  await current()
);
check(
  'the e-stop status clears',
  await waitFor(async () => (await row())?.status !== 'SW_EMERGENCY', 5000),
  (await row())?.status
);
e.clear();
m.clear();
await hw(1);
check(
  'real hardware ack reaches the dashboard',
  await e.waitEvent('HARDWARE_EMERGENCY_ACK', p => p.status === true),
  e.received
);
check(
  'the robot record shows hardware e-stop',
  await waitFor(async () => (await row())?.status === 'HW_EMERGENCY', 4000),
  (await row())?.status
);
check(
  'hardware pauses the mission too',
  await m.waitEvent('MISSION_CONTROL_ACK', p => p.requestType === 'PAUSE_MISSION'),
  m.received.slice(-3)
);
e.send({ event: 'SOFTWARE_EMERGENCY', payload: { status: false } });
await sleep(500);
check(
  'software release cannot override hardware',
  (await real()).hw === true && (await real()).mission.paused === true,
  await real()
);
m.clear();
await hw(0);
check(
  'hardware release resumes',
  await m.waitEvent('MISSION_CONTROL_ACK', p => p.requestId === 'EMERGENCY_AUTO_RESUME'),
  m.received
);
const ce = (await m.waitEvent(
  'MISSION_COMPLETED',
  p => p.runId === se?.payload?.runId,
  15000
)) as any;
check('and it completes', ce?.payload?.status === 'success', ce);

section('mode change through the real bridge');
m.clear();
m.send(cmd('CHANGE_MODE', { targetMode: 'teleopActive' }, 'mode-1'));
const teleop = (await m.waitEvent('MODE_CHANGE_ACK')) as any;
check(
  'teleop acknowledged',
  teleop?.payload?.currentMode === 'teleop' && (await real()).mode === 'teleop',
  teleop
);
check(
  'stored mission state follows',
  await waitFor(async () => (await row())?.mission?.mode === 'teleop', 2000),
  (await row())?.mission
);
m.clear();
m.send(cmd('CHANGE_MODE', { targetMode: 'warp' }, 'mode-2'));
const badMode = (await m.waitEvent('MODE_CHANGE_ACK')) as any;
check('real refusal surfaces', badMode?.payload?.error === 'unknown_targetMode', badMode);
m.clear();
m.send(cmd('CHANGE_MODE', { targetMode: 'autonomousActive' }, 'mode-3'));
await m.waitEvent('MODE_CHANGE_ACK');

section('rosbridge down while the other bridges are up');
const t = await openSocket(`/ws/robots/${id}/telemetry/real`, acmeOp.cookie);
await sleep(800);
t.send({
  type: 'command',
  channel: 'teleop',
  commandId: 't',
  data: { linear: { x: 0.1, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } },
});
const refused = await waitFor(() => t.received.find(r => r.type === 'error'), 3000);
check('teleop reports the failure instead of pretending', refused, t.received.slice(-2));
check('mission bridge is unaffected', (await real()).connections['9487'] === 1);

section('real status tick arrives and matches');
const tickBefore = (await row())?.mission?.lastSeenTs;
const ticked = await waitFor(async () => (await row())?.mission?.lastSeenTs !== tickBefore, 32000);
check('the real 30s status update arrives', ticked, (await row())?.mission);
const noErrors = backendLogs('5m')
  .split('\n')
  .filter(l => /Uncaught exception|Unhandled rejection|^Bun v1/.test(l));
check('no unhandled backend errors', noErrors.length === 0, noErrors.slice(0, 2));
const logLines = backendLogs('5m').split('\n');
const dropped = logLines.filter(
  (l, i) => /Dropped ROBOT_STATUS_UPDATE/.test(l) && logLines[i + 1]?.includes(id)
);
check('the backend never rejected a real status update', dropped.length === 0, dropped.slice(0, 2));

m.close();
e.close();
t.close();
finish();
