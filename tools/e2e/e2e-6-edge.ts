// Edge cases: hostile input at every door, browser security flags, deleting things in use.
import { connect as tcpConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import {
  backendLogs,
  call,
  check,
  finish,
  IS_TLS,
  mockIp,
  mongoJson,
  note,
  openSocket,
  robotPorts,
  section,
  signIn,
  state,
  stats,
  WEB,
  waitFor,
} from './e2e-lib';

const { staff, acme, acmeOp, beta, a1, a2, acmeOrg, betaOrg } = state;
const no500 = (name: string, r: { status: number; json?: any }) =>
  check(
    `${name} is a client error, not a 500 (${r.status})`,
    r.status >= 400 && r.status < 500,
    r.json
  );

section('malformed ids');
for (const [method, path] of [
  ['GET', '/api/robots/not-an-id'],
  ['PATCH', '/api/robots/not-an-id'],
  ['DELETE', '/api/robots/not-an-id'],
  ['GET', '/api/robots/not-an-id/maps'],
  ['POST', '/api/robots/not-an-id/map-sync'],
  ['GET', '/api/robots/not-an-id/current-mission'],
  ['POST', '/api/robots/not-an-id/active-map'],
  ['GET', '/api/maps/not-an-id'],
  ['GET', '/api/maps/not-an-id/image'],
  ['GET', '/api/maps/not-an-id/display/webp'],
  ['PUT', '/api/users/not-an-id'],
  ['DELETE', '/api/users/not-an-id'],
  ['POST', '/api/users/not-an-id/reset-password'],
] as const) {
  const body =
    method === 'GET' || method === 'DELETE' ? undefined : { mapId: 'not-an-id', name: 'x' };
  no500(
    `${method} ${path}`,
    await call(path, { cookie: acme.cookie, method, ...(body ? { body } : {}) })
  );
}
for (const [method, path] of [
  ['POST', '/api/staff/orgs/not-an-id/enter'],
  ['POST', '/api/staff/orgs/not-an-id/admins'],
  ['POST', '/api/staff/orgs/not-an-id/addresses'],
  ['POST', '/api/staff/addresses/not-an-id/approve'],
  ['POST', '/api/staff/addresses/not-an-id/reject'],
  ['DELETE', '/api/staff/addresses/not-an-id'],
  ['POST', '/api/staff/robots/not-an-id/move'],
] as const) {
  const body =
    method === 'DELETE'
      ? undefined
      : { orgId: 'not-an-id', ip: '10.1.2.3', username: 'zz-user', email: 'zz@example.test' };
  no500(
    `${method} ${path}`,
    await call(path, { cookie: staff.cookie, method, ...(body ? { body } : {}) })
  );
}
no500(
  'map display in a bad format',
  await call(`/api/maps/not-an-id/display/gif`, { cookie: acme.cookie })
);
let badSocket = 'opened';
try {
  await openSocket('/ws/robots/not-an-id/telemetry/x', acme.cookie);
} catch {
  badSocket = 'refused';
}
check('a socket on a malformed robot id is refused', badSocket === 'refused');

section('query string abuse');
for (const q of [
  'limit=abc',
  'limit=-1',
  'limit=999999',
  'status=%3Cx%3E',
  'robotId=a&robotId=b',
  'robotId[$ne]=x',
  'robotId=not-an-id',
]) {
  const r = await call(`/api/mission-runs?${q}`, { cookie: acme.cookie });
  check(`mission-runs?${q} stays safe (${r.status})`, r.status < 500, r.json);
  const leaked = (r.json?.data ?? []).some((run: any) => run.orgId !== acmeOrg);
  check(`mission-runs?${q} leaks nothing`, !leaked, r.json?.data?.slice?.(0, 1));
}

section('injection-looking bodies');
for (const body of [
  { username: { $ne: '' }, password: { $ne: '' } },
  { username: ['acme-admin'], password: ['x'] },
  { username: 'acme-admin' },
  {},
  [],
]) {
  const r = await call('/api/auth/sign-in', { method: 'POST', body });
  check(
    `sign-in with ${JSON.stringify(body)} is refused (${r.status})`,
    r.status >= 400 && r.status < 500,
    r.json
  );
}
for (const body of [
  { name: { $ne: '' }, ipAddress: '10.9.9.9' },
  { name: 'Bad Org Field', ipAddress: '10.9.9.9', orgId: betaOrg },
  { name: 'x'.repeat(100_000), ipAddress: '10.9.9.9' },
  { name: 'Bad Ports', ipAddress: '10.9.9.9', bridgePort: 'abc' },
  { name: 'Bad Ports', ipAddress: '10.9.9.9', bridgePort: 99999999 },
  { name: 'Loopback', ipAddress: '127.0.0.1' },
  { name: 'Metadata', ipAddress: '169.254.169.254' },
  { name: 'Mapped loopback', ipAddress: '::ffff:127.0.0.1' },
  { name: 'Hostname', ipAddress: 'mongo' },
  { name: 'Url', ipAddress: 'http://10.0.0.1/' },
]) {
  const r = await call('/api/robots', { cookie: acme.cookie, method: 'POST', body });
  note(
    `POST /robots ${JSON.stringify(body).slice(0, 70)} -> ${r.status} ${r.json?.data?.orgId === acmeOrg ? '(in Acme)' : ''} ${r.json?.error ? String(typeof r.json.error === 'string' ? r.json.error : 'validation').slice(0, 60) : ''}`
  );
  check(`… never a 500 (${r.status})`, r.status < 500, r.json);
  if (r.json?.data?.id) {
    check(
      '… and any robot created stays in the caller’s org',
      r.json.data.orgId === acmeOrg,
      r.json.data.orgId
    );
    await call(`/api/robots/${r.json.data.id}`, { cookie: acme.cookie, method: 'DELETE' });
  }
}
const beforePatch = await call(`/api/robots/${a1}`, { cookie: acme.cookie });
const orgMove = await call(`/api/robots/${a1}`, {
  cookie: acme.cookie,
  method: 'PATCH',
  body: { orgId: betaOrg },
});
const afterPatch = await call(`/api/robots/${a1}`, { cookie: acme.cookie });
check(
  `PATCH cannot move a robot to another org (${orgMove.status})`,
  afterPatch.json?.data?.orgId === acmeOrg,
  afterPatch.json?.data?.orgId
);
check(
  'PATCH with junk leaves the robot working',
  afterPatch.status === 200 && beforePatch.json?.data?.name === afterPatch.json?.data?.name
);

const big = await fetch(`${WEB}/api/robots`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie: acme.cookie },
  body: JSON.stringify({ name: 'big', ipAddress: '10.9.9.9', pad: 'x'.repeat(30 * 1024 * 1024) }),
});
check(`a 30MB body is refused (${big.status})`, big.status === 413, big.status);
const notJson = await fetch(`${WEB}/api/robots`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie: acme.cookie },
  body: '{not json',
});
check(`malformed JSON is a 400 (${notJson.status})`, notJson.status === 400, notJson.status);

section('duplicate names');
const dupe = await call('/api/robots', {
  cookie: acme.cookie,
  method: 'POST',
  body: { name: 'Forklift A1', ipAddress: mockIp('a1'), ...robotPorts },
});
check(
  `same robot name in one org is a conflict (${dupe.status})`,
  dupe.status === 409 || dupe.status === 400,
  dupe.json
);
const sameName = await call('/api/robots', {
  cookie: beta.cookie,
  method: 'POST',
  body: { name: 'Forklift A1', ipAddress: '10.9.9.11', ...robotPorts },
});
check(`another org can use that name (${sameName.status})`, sameName.status === 200, sameName.json);
if (sameName.json?.data?.id)
  await call(`/api/robots/${sameName.json.data.id}`, { cookie: beta.cookie, method: 'DELETE' });
const dupeUser = await call('/api/users', {
  cookie: acme.cookie,
  method: 'POST',
  body: { username: 'beta-admin', email: 'someone@example.test', role: 'USER' },
});
note(
  `username already used in another org: ${dupeUser.status} ${JSON.stringify(dupeUser.json?.error ?? dupeUser.json?.message)}`
);
check(
  'a taken username never exposes the other org',
  !JSON.stringify(dupeUser.json ?? {}).includes('Beta'),
  dupeUser.json
);
const dupeSlug = await call('/api/staff/orgs', {
  cookie: staff.cookie,
  method: 'POST',
  body: { name: 'Acme Two', slug: 'acme', username: 'a2-admin', email: 'a2@example.test' },
});
check(
  `a taken org slug is a conflict (${dupeSlug.status})`,
  dupeSlug.status === 409,
  dupeSlug.json
);
const badSlug = await call('/api/staff/orgs', {
  cookie: staff.cookie,
  method: 'POST',
  body: { name: 'Bad', slug: 'BAD SLUG!', username: 'bad-admin', email: 'bad@example.test' },
});
check(`a bad slug is refused (${badSlug.status})`, badSlug.status === 400, badSlug.json);

section('role boundaries');
for (const [method, path, body] of [
  ['POST', '/api/robots', { name: 'nope', ipAddress: '10.9.9.12' }],
  ['PATCH', `/api/robots/${a1}`, { name: 'hacked' }],
  ['DELETE', `/api/robots/${a1}`, undefined],
  ['GET', '/api/users', undefined],
  ['POST', '/api/users', { username: 'x', email: 'x@example.test' }],
  ['GET', '/api/staff/orgs', undefined],
  ['GET', '/api/staff/addresses', undefined],
] as const) {
  const r = await call(path, { cookie: acmeOp.cookie, method, ...(body ? { body } : {}) });
  check(
    `a member ${method} ${path.replace(a1, ':id')} is 403 (${r.status})`,
    r.status === 403,
    r.json
  );
}
const selfPromote = await call(`/api/users/${acmeOp.id}`, {
  cookie: acmeOp.cookie,
  method: 'PUT',
  body: { role: 'ADMIN' },
});
check(`a member cannot promote themselves (${selfPromote.status})`, selfPromote.status === 403);
const staffId = mongoJson(`db.User.findOne({username:'e2e-staff'})._id`).$oid;
const hitStaff = await call(`/api/users/${staffId}`, { cookie: acme.cookie, method: 'DELETE' });
check(
  `an org admin cannot delete staff (${hitStaff.status})`,
  hitStaff.status >= 400 && hitStaff.status < 500,
  hitStaff.json
);
const fake = await call('/api/robots', { cookie: 'better-auth.session_token=forged-token-value' });
check(`a forged cookie is refused (${fake.status})`, fake.status === 401, fake.status);
const fakeSql = await call('/api/robots', { cookie: 'better-auth.session_token={"$ne":""}' });
check(
  `an object-shaped cookie is refused (${fakeSql.status})`,
  fakeSql.status === 401,
  fakeSql.status
);

section('browser security flags');
const login = await signIn('beta-admin', beta.password);
const setCookie = login.headers.get('set-cookie') ?? '';
note(`Set-Cookie flags: ${setCookie.replace(/=[^;]+/, '=…').slice(0, 160)}`);
check('session cookie is HttpOnly', /httponly/i.test(setCookie), setCookie.replace(/=[^;]+/, '=…'));
check(
  'session cookie is SameSite=Lax or stricter, so another site cannot open a socket with it',
  /samesite=(lax|strict)/i.test(setCookie),
  setCookie.replace(/=[^;]+/, '=…')
);
const evil = await fetch(`${WEB}/api/robots`, {
  method: 'OPTIONS',
  headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
});
const acao = evil.headers.get('access-control-allow-origin');
check(
  `CORS does not allow another site (${acao})`,
  !acao || (acao !== '*' && !acao.includes('evil')),
  acao
);
const rawHandshake = (host: string, origin: string, cookie: string) =>
  new Promise<number>((resolve, reject) => {
    const onOpen = () => {
      socket.write(
        [
          `GET /ws/robots/${a1}/emergency/edge HTTP/1.1`,
          `Host: ${host}`,
          'Connection: Upgrade',
          'Upgrade: websocket',
          'Sec-WebSocket-Version: 13',
          `Sec-WebSocket-Key: ${btoa(crypto.randomUUID().slice(0, 16))}`,
          `Origin: ${origin}`,
          `Cookie: ${cookie}`,
          '',
          '',
        ].join('\r\n')
      );
    };
    const socket = IS_TLS
      ? tlsConnect({ port: 18443, host: '127.0.0.1', rejectUnauthorized: false }, onOpen)
      : tcpConnect(18080, '127.0.0.1', onOpen);
    socket.once('data', chunk => {
      socket.destroy();
      resolve(Number(/^HTTP\/1\.1 (\d+)/.exec(chunk.toString())?.[1]));
    });
    socket.once('error', reject);
  });
const acmeCookie = (await signIn('acme-admin', acme.password)).cookie;
const dashHost = IS_TLS ? 'dash.test:18443' : 'dash.test:18080';
const scheme = IS_TLS ? 'https' : 'http';
check(
  'a socket from the dashboard’s own address works behind nginx',
  (await rawHandshake(dashHost, `${scheme}://${dashHost}`, acmeCookie)) === 101
);
check(
  'a socket from another port on that host is refused',
  (await rawHandshake(dashHost, `${scheme}://dash.test:9000`, acmeCookie)) === 403
);
check(
  'a socket from another site is refused',
  (await rawHandshake(dashHost, 'https://evil.example', acmeCookie)) === 403
);
if (IS_TLS) {
  check(
    'over HTTPS in production the session cookie is Secure',
    /;\s*secure/i.test(setCookie),
    setCookie.replace(/=[^;]+/, '=…')
  );
  const preflight = await fetch(`${WEB}/api/robots`, {
    method: 'OPTIONS',
    headers: { origin: WEB, 'access-control-request-method': 'POST' },
  });
  check(
    'the real frontend origin gets CORS access',
    preflight.headers.get('access-control-allow-origin') === WEB,
    preflight.headers.get('access-control-allow-origin')
  );
  const signOut = await signIn('beta-admin', beta.password);
  const out = await call('/api/auth/sign-out', { method: 'POST', cookie: signOut.cookie });
  check(
    'signing out clears the cookie with Secure too',
    /;\s*secure/i.test(out.headers.get('set-cookie') ?? ''),
    out.headers.get('set-cookie')?.replace(/=[^;]+/, '=…')
  );
}
const longName = await call('/api/robots', {
  cookie: acme.cookie,
  method: 'POST',
  body: { name: 'x'.repeat(101), ipAddress: '10.9.9.13' },
});
check(
  `a 101-character robot name is refused (${longName.status})`,
  longName.status === 400,
  longName.status
);
const home = await fetch(`${WEB}/`);
check(
  'the page cannot be framed by another site',
  home.headers.get('x-frame-options') === 'DENY',
  home.headers.get('x-frame-options')
);
note(
  `page headers: x-frame-options=${home.headers.get('x-frame-options')} csp=${home.headers.get('content-security-policy')?.slice(0, 60)}`
);
const apiHeaders = await call('/api/robots', { cookie: acme.cookie });
note(
  `api headers: x-frame-options=${apiHeaders.headers.get('x-frame-options')} nosniff=${apiHeaders.headers.get('x-content-type-options')} cache=${apiHeaders.headers.get('cache-control')}`
);
const session = await call('/api/auth/session', { cookie: acme.cookie });
check(
  'the session endpoint never exposes secrets',
  !/passwordHash|tempPassword|token/i.test(session.text),
  Object.keys(session.json?.user ?? {})
);
const users = await call('/api/users', { cookie: acme.cookie });
check('the user list never exposes hashes', !/passwordHash|Pw-/i.test(users.text));

section('deleting things in use');
const sock = await openSocket(`/ws/robots/${a2}/telemetry/edge`, acme.cookie);
const misSock = await openSocket(`/ws/robots/${a2}/mapping/edge`, acme.cookie);
await sock.waitChannel('amcl');
misSock.send({ type: 'command', event: 'SHOW_UP', commandId: 'd-1', payload: { missionId: 1 } });
await misSock.waitEvent('MISSION_CONTROL_ACK', p => p.requestId === 'd-1');
misSock.send({
  type: 'command',
  event: 'START_MISSION',
  commandId: 'd-2',
  payload: { missionId: 1 },
});
await misSock.waitEvent('MISSION_START_ACK', p => p.requestId === 'd-2');
const del = await call(`/api/robots/${a2}`, { cookie: acme.cookie, method: 'DELETE' });
check(`an org admin deletes a robot mid-mission (${del.status})`, del.status === 200, del.json);
check(
  'the backend hangs up on the robot',
  await waitFor(async () => {
    const s = await stats('a2');
    return s.connections[9090] === 0 && s.connections[9487] === 0 && s.connections[8766] === 0;
  }, 8000),
  (await stats('a2')).connections
);
check(
  'open dashboard sockets close within the re-check',
  await waitFor(() => sock.closeCode() !== null, 40000),
  sock.closeCode()
);
check(
  'its robot record is gone',
  (await call(`/api/robots/${a2}`, { cookie: acme.cookie })).status === 404
);
check(
  'mission history survives',
  (await call(`/api/mission-runs?limit=100`, { cookie: acme.cookie })).status === 200
);
const orphanLinks = mongoJson(`db.RobotMap.countDocuments({robotId:ObjectId('${a2}')})`);
check('its map links are gone', orphanLinks === 0, orphanLinks);
check(
  'the address stays with the org',
  mongoJson(
    `db.RobotAddress.countDocuments({ip:'${mockIp('a2')}',orgId:ObjectId('${acmeOrg}'),status:'APPROVED'})`
  ) === 1
);
check(
  'no other org can take it',
  (
    await call('/api/robots', {
      cookie: beta.cookie,
      method: 'POST',
      body: { name: 'Taker', ipAddress: mockIp('a2'), ...robotPorts },
    })
  ).json?.data?.addressStatus === 'PENDING'
);
const recreated = await call('/api/robots', {
  cookie: acme.cookie,
  method: 'POST',
  body: { name: 'Forklift A2', ipAddress: mockIp('a2'), ...robotPorts },
});
check(
  'the org can re-add it, approved straight away',
  recreated.json?.data?.addressStatus === 'APPROVED',
  recreated.json
);
check(
  'and it connects',
  await waitFor(async () => (await stats('a2')).connections[9090] >= 2, 15000)
);

const selfDelete = await call(
  `/api/users/${mongoJson(`db.User.findOne({username:'acme-admin'})._id`).$oid}`,
  { cookie: acme.cookie, method: 'DELETE' }
);
note(
  `an admin deleting themselves: ${selfDelete.status} ${JSON.stringify(selfDelete.json?.error)}`
);

const fatal = backendLogs('6m')
  .split('\n')
  .filter(l => /Uncaught exception|Unhandled rejection|^Bun v1/i.test(l));
check('no unhandled errors in the backend', fatal.length === 0, fatal.slice(0, 2));
const errors500 = backendLogs('6m')
  .split('\n')
  .filter(l => /Internal server error|"statusCode":500|statusCode: 500/.test(l));
note(`500-level lines in the log: ${errors500.length}`);
finish();
