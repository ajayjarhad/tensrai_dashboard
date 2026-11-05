// Try to break it: robot faults, garbage, restarts, revoked access, moved robots.
import {
  backendLogs,
  COMPOSE,
  call,
  check,
  ctl,
  finish,
  finishSetup,
  mockIp,
  mongoJson,
  note,
  openSocket,
  saveState,
  section,
  sh,
  signIn,
  sleep,
  state,
  stats,
  waitFor,
} from './e2e-lib';

const { staff, acme, acmeOp, beta, betaOp, a1, a2, b1, acmeOrg, betaOrg } = state;
const cmd = (event: string, payload: object, commandId: string) => ({
  type: 'command',
  event,
  commandId,
  payload,
});
const current = async (robotId: string, cookie = acme.cookie) =>
  (await call(`/api/robots/${robotId}/current-mission`, { cookie })).json?.data;
const runs = async (robotId: string, cookie = acme.cookie) =>
  (await call(`/api/mission-runs?robotId=${robotId}&limit=100`, { cookie })).json?.data ?? [];
const startMission = async (m: any, tag: string, missionId = 1) => {
  m.clear();
  m.send(cmd('SHOW_UP', { missionId }, `show-${tag}`));
  await m.waitEvent('MISSION_CONTROL_ACK', (p: any) => p.requestId === `show-${tag}`);
  m.send(cmd('START_MISSION', { missionId }, `start-${tag}`));
  return (await m.waitEvent(
    'MISSION_START_ACK',
    (p: any) => p.requestId === `start-${tag}`
  )) as any;
};
const connected = (r: 'a1' | 'a2' | 'b1') =>
  waitFor(async () => {
    const s = await stats(r);
    return s.connections[9090] >= 2 && s.connections[9487] >= 1 && s.connections[8766] >= 1;
  }, 40000);

section('garbage from a robot does not hurt the backend or other robots');
const tel = await openSocket(`/ws/robots/${a1}/telemetry/e2e`, acme.cookie);
const mis = await openSocket(`/ws/robots/${a1}/mapping/e2e`, acme.cookie);
const eme = await openSocket(`/ws/robots/${a1}/emergency/e2e`, acme.cookie);
const betaTel = await openSocket(`/ws/robots/${b1}/telemetry/e2e`, beta.cookie);
await betaTel.waitChannel('amcl');
for (const port of [9487, 8766, 9090, 8765]) await ctl('a1', `/garbage?port=${port}`);
await sleep(1500);
check('backend still answers', (await call('/api/robots', { cookie: acme.cookie })).status === 200);
betaTel.clear();
check('Beta’s telemetry is unaffected', await betaTel.waitChannel('amcl'));
tel.clear();
const stillStreams = await tel.waitChannel('amcl', () => true, 6000);
check('the attacked robot’s telemetry still flows', stillStreams, (await stats('a1')).connections);
check('robot connections survived', await connected('a1'));
note(`after garbage connections: ${JSON.stringify((await stats('a1')).connections)}`);
const row = await call(`/api/robots/${a1}`, { cookie: acme.cookie });
check(
  'robot record still loads with sane mission state',
  row.status === 200 && typeof row.json?.data?.mission?.phase === 'string',
  row.json?.data?.mission
);
note(`mission state after garbage: ${JSON.stringify(row.json?.data?.mission).slice(0, 300)}`);
check(
  'garbage created no runs from injection-looking ids',
  mongoJson(`db.MissionRun.countDocuments({runId:{$type:'object'}})`) === 0
);
const garbageRuns = await current(a1);
note(`current run after garbage: ${JSON.stringify(garbageRuns)?.slice(0, 200)}`);
check('a garbage ack did not fabricate a current run', !garbageRuns, garbageRuns);
const mode = await waitFor(() => tel.closeCode() === null, 1000);
check(
  'dashboard sockets stayed open',
  mode && mis.closeCode() === null && eme.closeCode() === null
);
const restartCount = sh([
  'docker',
  'inspect',
  '-f',
  '{{.RestartCount}}',
  'dashboard-e2e-backend-1',
]).out.trim();
note(`backend restarts so far: ${restartCount}`);
check(
  'the backend process did not restart',
  restartCount === process.env.RESTARTS_BEFORE,
  restartCount
);
const crash = /Uncaught exception|Unhandled rejection|Bun v1/i.test(backendLogs('1m'));
note(
  `backend threw on garbage: ${crash} ${
    backendLogs('1m')
      .match(/.*(Uncaught exception|Unhandled rejection|Bun v1).*/i)?.[0]
      ?.slice(0, 300) ?? ''
  }`
);
check('no unhandled exception from garbage', !crash);

section('laser fuzz');
for (const m of ['nulls', 'empty', 'zeroinc', 'missing', 'strings', 'huge']) {
  await ctl('a1', `/laser?mode=${m}`);
  tel.clear();
  await sleep(1200);
  const last = tel.channel('laser').at(-1)?.data;
  note(
    `laser ${m}: frames=${tel.channel('laser').length}, ranges=${Array.isArray(last?.ranges) ? last.ranges.length : typeof last?.ranges}, bytes=${JSON.stringify(last ?? {}).length}`
  );
  check(
    `laser ${m}: socket stays open, amcl still flows`,
    tel.closeCode() === null && tel.channel('amcl').length > 0,
    tel.closeCode()
  );
  if (m === 'huge')
    check(
      'a huge scan is capped before it reaches browsers',
      (last?.ranges?.length ?? 0) <= 2000,
      last?.ranges?.length
    );
}
await ctl('a1', '/laser?mode=normal');
tel.clear();
check(
  'laser recovers',
  await tel.waitChannel('laser', d => Array.isArray(d.ranges) && d.ranges.length > 10, 5000)
);

section('robot network drop mid-mission');
const run1 = await startMission(mis, 'drop');
const run1Id = run1?.payload?.runId;
await mis.waitEvent('WAYPOINT_ACK', p => p.waypointIndex === 1 && p.runId === run1Id);
await ctl('a1', '/drop');
await sleep(200);
check(
  'robot bridges come back by themselves',
  await connected('a1'),
  (await stats('a1')).connections
);
await ctl('a1', '/status');
const midRun = await waitFor(
  async () => (await current(a1))?.runId === run1Id && (await current(a1)),
  3000
);
check('the run is still tracked after the drop', midRun, await current(a1));
mis.clear();
const relayed = await mis.waitEvent('MISSION_COMPLETED', p => p.runId === run1Id, 15000);
check(
  'completion after reconnect still reaches the dashboard',
  (relayed as any)?.payload?.status === 'success',
  mis.received.slice(-3)
);
const finished = await waitFor(
  async () => (await runs(a1)).find((r: any) => r.runId === run1Id && r.status === 'COMPLETED'),
  3000
);
check(
  'and is stored',
  finished,
  (await runs(a1)).find((r: any) => r.runId === run1Id)
);
tel.clear();
check(
  'telemetry resumes on the same dashboard socket',
  await tel.waitChannel('amcl', () => true, 8000),
  tel.closeCode()
);
const subsAfter = (await stats('a1')).connections;
note(`connections after reconnect: ${JSON.stringify(subsAfter)}`);
check(
  'no duplicate connections piled up',
  subsAfter[9090] <= 3 && subsAfter[9487] === 1 && subsAfter[8766] === 1,
  subsAfter
);

section('commands while the robot is unreachable');
await ctl('a1', '/refuse?on=1');
await ctl('a1', '/drop');
await sleep(600);
mis.clear();
mis.send(cmd('START_MISSION', { missionId: 1 }, 'offline-start'));
const offlineAck = (await mis.waitEvent(
  'MISSION_START_ACK',
  p => p.requestId === 'offline-start',
  6000
)) as any;
check(
  'a mission command says the robot is not connected',
  offlineAck?.payload?.status === 'failure',
  mis.received.slice(-2)
);
note(`offline start: ${offlineAck?.payload?.message}`);
eme.clear();
eme.send({ event: 'SOFTWARE_EMERGENCY', payload: { status: true } });
const offlineEstop = await waitFor(
  () =>
    eme.received.find(
      r =>
        r.type === 'error' ||
        r.event === 'EMERGENCY_BRIDGE_ERROR' ||
        /not connected/i.test(JSON.stringify(r))
    ),
  5000
);
check('an e-stop that cannot reach the robot says so', offlineEstop, eme.received.slice(-3));
note(`offline e-stop: ${JSON.stringify(offlineEstop).slice(0, 200)}`);
tel.clear();
tel.send({
  type: 'command',
  channel: 'teleop',
  commandId: 'offline-tele',
  data: { linear: { x: 0.2, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } },
});
const offlineTeleop = await waitFor(() => tel.received.find(r => r.type === 'error'), 3000);
check('teleop to an unreachable robot reports an error', offlineTeleop, tel.received.slice(-2));
await ctl('a1', '/refuse?on=0');
check(
  'the robot reconnects when it is back',
  await connected('a1'),
  (await stats('a1')).connections
);

section('robot restart mid-mission: its runId counter starts over');
const before = await startMission(mis, 'pre-restart');
const preId = before?.payload?.runId;
await mis.waitEvent('WAYPOINT_ACK', p => p.waypointIndex === 1 && p.runId === preId);
const runsBefore = (await runs(a1)).length;
sh(['docker', 'restart', '-t', '0', 'mock-a1']);
await sleep(1000);
check('robot comes back and reconnects', await connected('a1'), 'no');
await sleep(800);
const afterRestart = await current(a1);
note(`after restart: robot idle, current run ${JSON.stringify(afterRestart)?.slice(0, 220)}`);
check(
  'a run the robot forgot is closed, not left running forever',
  !afterRestart || !['RUNNING', 'PAUSED'].includes(afterRestart.status),
  afterRestart
);
const oldRun = (await runs(a1)).find((r: any) => r.runId === preId);
note(`old run: ${oldRun?.status} ${oldRun?.lastMessage}`);
const fresh = await startMission(mis, 'post-restart');
const freshId = fresh?.payload?.runId;
check('the restarted robot starts again at runId 1', freshId === '1', freshId);
const c1 = await mis.waitEvent('MISSION_COMPLETED', p => p.runId === freshId, 15000);
check('new mission completes', (c1 as any)?.payload?.status === 'success');
await sleep(500);
const withSameId = (await runs(a1)).filter((r: any) => r.runId === '1');
note(`runs with runId 1: ${withSameId.map((r: any) => `${r.status}@${r.startedAt}`).join(' ')}`);
const newest = withSameId[0];
check(
  'the new run is the one completed, with fresh timestamps',
  newest?.status === 'COMPLETED' && Date.now() - Date.parse(newest?.endedAt) < 10000,
  newest
);
const history = (await runs(a1)).length;
check('old history was not rewritten', history >= runsBefore, { history, runsBefore });

section('a mission survives a backend restart');
const b4 = await startMission(mis, 'backend-restart');
const b4Id = b4?.payload?.runId;
tel.close();
mis.close();
eme.close();
betaTel.close();
sh(['docker', ...COMPOSE, 'restart', '-t', '2', 'backend']);
const healthy = await waitFor(
  () =>
    sh([
      'docker',
      'inspect',
      '-f',
      '{{.State.Health.Status}}',
      'dashboard-e2e-backend-1',
    ]).out.trim() === 'healthy',
  120000
);
check('backend comes back', healthy);
check('it reconnects to the robots', await connected('a1'), (await stats('a1')).connections);
const mis2 = await openSocket(`/ws/robots/${a1}/mapping/e2e`, acme.cookie);
await sleep(8000);
await ctl('a1', '/status');
await sleep(500);
const postRestartRun = (await runs(a1)).find((r: any) => r.runId === b4Id);
note(`run after backend restart: ${postRestartRun?.status} ${postRestartRun?.lastEvent}`);
check(
  'run does not stay running forever when the robot finished during the restart',
  postRestartRun && postRestartRun.status !== 'RUNNING',
  postRestartRun
);
const c = await call(`/api/robots/${a1}`, { cookie: acme.cookie });
note(`robot mission after restart: ${JSON.stringify(c.json?.data?.mission).slice(0, 240)}`);
check('sessions survived the restart', c.status === 200, c.status);
mis2.close();

section('PATCH the address while connected');
const patchTo = mockIp('a2');
const addr = await call(`/api/robots/${a1}`, {
  cookie: acme.cookie,
  method: 'PATCH',
  body: { ipAddress: patchTo },
});
note(
  `PATCH to Acme’s other robot’s approved address: ${addr.status} ${JSON.stringify(addr.json?.data?.addressStatus)}`
);
await sleep(1500);
const a1After = await stats('a1');
check(
  'moving a robot’s address disconnects the old target',
  a1After.connections[9090] === 0 && a1After.connections[9487] === 0,
  a1After.connections
);
const back = await call(`/api/robots/${a1}`, {
  cookie: acme.cookie,
  method: 'PATCH',
  body: { ipAddress: mockIp('a1') },
});
check(
  'moving back is approved straight away',
  back.json?.data?.addressStatus === 'APPROVED',
  back.json
);
check('and reconnects', await connected('a1'), (await stats('a1')).connections);
const steal = await call(`/api/robots/${b1}`, {
  cookie: beta.cookie,
  method: 'PATCH',
  body: { ipAddress: mockIp('a1') },
});
check(
  'Beta pointing its robot at Acme’s robot is only “pending”',
  steal.status === 200 && steal.json?.data?.addressStatus === 'PENDING',
  steal.json
);
await sleep(1500);
const b1Now = await stats('b1');
check('Beta’s robot dropped its old connection', b1Now.connections[9090] === 0, b1Now.connections);
const acmeConns = (await stats('a1')).connections;
check(
  'Beta got no extra connections onto Acme’s robot',
  acmeConns[9090] <= 2 && acmeConns[9487] === 1,
  acmeConns
);
await ctl('a1', '/reset');
const betaTelOnAcme = await openSocket(`/ws/robots/${b1}/telemetry/e2e`, beta.cookie);
await sleep(1500);
betaTelOnAcme.send({
  type: 'command',
  channel: 'teleop',
  commandId: 'steal',
  data: { linear: { x: 0.5, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } },
});
await sleep(800);
check(
  'Beta’s teleop does not reach Acme’s robot',
  (await stats('a1')).received.cmdVel.length === 0,
  (await stats('a1')).received.cmdVel.length
);
check(
  'Beta gets no Acme telemetry',
  betaTelOnAcme.channel('amcl').length === 0,
  betaTelOnAcme.channel('amcl').length
);
betaTelOnAcme.close();
const betaSync = await call(`/api/robots/${b1}/map-sync`, { cookie: beta.cookie, method: 'POST' });
check('Beta’s map sync from Acme’s address is refused', betaSync.status === 409, betaSync.status);
const restoreBeta = await call(`/api/robots/${b1}`, {
  cookie: beta.cookie,
  method: 'PATCH',
  body: { ipAddress: mockIp('b1') },
});
check(
  'Beta restores its address',
  restoreBeta.json?.data?.addressStatus === 'APPROVED',
  restoreBeta.json
);
check('Beta’s robot reconnects', await connected('b1'));

section('access ends while a socket is open');
const opSock = await openSocket(`/ws/robots/${a1}/telemetry/e2e`, acmeOp.cookie);
await call(`/api/users/${acmeOp.id}`, {
  cookie: acme.cookie,
  method: 'PUT',
  body: { isActive: false },
});
const closed = await waitFor(() => opSock.closeCode() !== null, 40000);
check(`a disabled member’s socket closes (code ${opSock.closeCode()})`, closed);
check(
  'and their REST calls stop',
  (await call('/api/robots', { cookie: acmeOp.cookie })).status !== 200
);
await call(`/api/users/${acmeOp.id}`, {
  cookie: acme.cookie,
  method: 'PUT',
  body: { isActive: true },
});
const op2 = await signIn('acme-op', acmeOp.password);
Object.assign(acmeOp, { cookie: op2.cookie });

section('moving a robot to another org');
const betaSock = await openSocket(`/ws/robots/${a2}/telemetry/e2e`, acme.cookie).catch(() => null);
const move = await call(`/api/staff/robots/${a2}/move`, {
  cookie: staff.cookie,
  method: 'POST',
  body: { orgId: betaOrg },
});
note(`move a2 to Beta: ${move.status} ${JSON.stringify(move.json)?.slice(0, 240)}`);
if (move.status === 200) {
  const closedOnMove = await waitFor(() => betaSock?.closeCode() !== null, 40000);
  check('the old org’s open socket closes', closedOnMove, betaSock?.closeCode());
  check(
    'old org loses the robot',
    (await call(`/api/robots/${a2}`, { cookie: acme.cookie })).status === 404
  );
  check(
    'new org has it',
    (await call(`/api/robots/${a2}`, { cookie: beta.cookie })).status === 200
  );
  check(
    'its maps moved',
    (await call(`/api/robots/${a2}/maps`, { cookie: beta.cookie })).json?.data?.length >= 2
  );
  check(
    'it stays connected for its new owner',
    await connected('a2'),
    (await stats('a2')).connections
  );
  const moveBack = await call(`/api/staff/robots/${a2}/move`, {
    cookie: staff.cookie,
    method: 'POST',
    body: { orgId: acmeOrg },
  });
  check('it can move back', moveBack.status === 200, moveBack.json);
} else {
  check('move refused for a clear reason', move.status === 409, move.json);
}

section('staff support mode');
const enter = await call(`/api/staff/orgs/${betaOrg}/enter`, {
  cookie: staff.cookie,
  method: 'POST',
});
check('staff enter Beta', enter.status === 200, enter.json);
const seen = (await call('/api/robots', { cookie: staff.cookie })).json?.data?.map(
  (r: any) => r.id
);
check(
  'they see exactly Beta’s robots',
  seen?.length >= 1 && seen.includes(b1) && !seen.includes(a1),
  seen
);
const staffSock = await openSocket(`/ws/robots/${b1}/telemetry/e2e`, staff.cookie);
check('and can open its live socket', await staffSock.waitChannel('amcl'));
let crossStaff = 'opened';
try {
  await openSocket(`/ws/robots/${a1}/telemetry/e2e`, staff.cookie);
} catch {
  crossStaff = 'refused';
}
check('but not Acme’s while inside Beta', crossStaff === 'refused');
staffSock.close();
check(
  'staff can leave',
  (await call('/api/staff/exit', { cookie: staff.cookie, method: 'POST' })).status === 200
);
const auditStaff = mongoJson(
  `db.AuditLog.countDocuments({action:{$regex:'STAFF|ORG_ENTER|ENTER'}})`
);
check('staff actions are audited', auditStaff >= 1, auditStaff);

section('address release while connected');
const list =
  (await call('/api/staff/addresses?status=APPROVED', { cookie: staff.cookie })).json?.data ?? [];
const b1Addr = list.find((e: any) => e.ip === mockIp('b1'));
const released = await call(`/api/staff/addresses/${b1Addr?.id}`, {
  cookie: staff.cookie,
  method: 'DELETE',
});
check('staff release Beta’s address', released.status === 200, released.json);
check(
  'the backend disconnects at once',
  await waitFor(async () => (await stats('b1')).connections[9090] === 0, 8000),
  (await stats('b1')).connections
);
const blank = await call(`/api/robots/${b1}`, { cookie: beta.cookie });
note(`after release: ipAddress=${blank.json?.data?.ipAddress}`);
const reAdd = await call(`/api/robots/${b1}`, {
  cookie: beta.cookie,
  method: 'PATCH',
  body: { ipAddress: mockIp('b1') },
});
check('re-adding needs approval again', reAdd.json?.data?.addressStatus === 'PENDING', reAdd.json);
const pendingAgain = (
  await call('/api/staff/addresses?status=PENDING', { cookie: staff.cookie })
).json?.data.find((e: any) => e.ip === mockIp('b1') && e.orgId === betaOrg);
await call(`/api/staff/addresses/${pendingAgain?.id}/approve`, {
  cookie: staff.cookie,
  method: 'POST',
});
check('approved again, it reconnects', await connected('b1'));

section('user management flows');
const reset = await call(`/api/users/${acmeOp.id}/reset-password`, {
  cookie: acme.cookie,
  method: 'POST',
});
check(
  'admin resets a member’s password',
  reset.status === 200 && reset.json?.data?.tempPassword,
  reset.status
);
check('their session ends', (await call('/api/robots', { cookie: acmeOp.cookie })).status === 401);
const reSetup = await finishSetup('acme-op', reset.json.data.tempPassword);
Object.assign(acmeOp, reSetup);
check(
  'they can set a new one',
  (await call('/api/robots', { cookie: acmeOp.cookie })).status === 200
);
const crossReset = await call(`/api/users/${acmeOp.id}/reset-password`, {
  cookie: beta.cookie,
  method: 'POST',
});
check('another org’s admin cannot reset them', crossReset.status === 404, crossReset.status);
const promote = await call(`/api/users/${betaOp.id}`, {
  cookie: beta.cookie,
  method: 'PUT',
  body: { role: 'STAFF' },
});
check('an org admin cannot make staff', promote.status >= 400, promote.json);
const nested = await call(`/api/users/${betaOp.id}`, {
  cookie: beta.cookie,
  method: 'PUT',
  body: { orgId: acmeOrg },
});
check(
  'an org admin cannot move a user across orgs',
  nested.status >= 400 ||
    mongoJson(`db.User.findOne({_id:ObjectId('${betaOp.id}')}).orgId`)?.$oid === betaOrg,
  nested.json
);

const fatal = backendLogs('10m')
  .split('\n')
  .filter(l => /Uncaught exception|Unhandled rejection|^Bun v1/i.test(l));
note(
  `unhandled lines: ${fatal.length}: ${fatal
    .slice(0, 3)
    .map(f => f.slice(0, 240))
    .join(' | ')}`
);
check('no unhandled errors in the backend log', fatal.length === 0);
saveState();
finish();
