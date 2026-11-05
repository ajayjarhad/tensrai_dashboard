// Onboarding: staff -> orgs -> admins -> members -> robots -> approval -> the backend connects.
import {
  COMPOSE,
  call,
  check,
  finish,
  finishSetup,
  mockIp,
  robotPorts,
  saveState,
  section,
  sh,
  sleep,
  state,
  stats,
  waitFor,
} from './e2e-lib';

section('onboarding');
const staffOut = sh([
  'docker',
  ...COMPOSE,
  'exec',
  '-T',
  'backend',
  'sh',
  '-c',
  'cd backend && bunx tsx scripts/createStaff.ts e2e-staff e2e-staff@example.test',
]);
const staffTemp = /Temporary password \(72h\): (\S+)/.exec(staffOut.out)?.[1] ?? '';
check('staff:create makes a staff user', staffTemp, staffOut.out.slice(-200));
const staff = await finishSetup('e2e-staff', staffTemp);

const makeOrg = async (name: string, slug: string, username: string) => {
  const res = await call('/api/staff/orgs', {
    cookie: staff.cookie,
    method: 'POST',
    body: { name, slug, username, email: `${username}@example.test` },
  });
  check(`staff create ${name}`, res.status === 201, res.json);
  return { org: res.json.data.org, admin: await finishSetup(username, res.json.data.tempPassword) };
};
const acme = await makeOrg('Acme Robotics', 'acme', 'acme-admin');
const beta = await makeOrg('Beta Logistics', 'beta', 'beta-admin');

const makeMember = async (adminCookie: string, username: string) => {
  const res = await call('/api/users', {
    cookie: adminCookie,
    method: 'POST',
    body: { username, email: `${username}@example.test`, role: 'USER' },
  });
  check(`org admin creates member ${username}`, res.status === 201 || res.json?.success, res.json);
  return {
    id: res.json.data.user.id,
    ...(await finishSetup(username, res.json.data.tempPassword)),
  };
};
const acmeOp = await makeMember(acme.admin.cookie, 'acme-op');
const betaOp = await makeMember(beta.admin.cookie, 'beta-op');

section('robots and address approval');
const addRobot = async (cookie: string, name: string, ip: string) => {
  const res = await call('/api/robots', {
    cookie,
    method: 'POST',
    body: { name, ipAddress: ip, ...robotPorts },
  });
  check(
    `${name} saved, waiting for approval`,
    res.status === 200 && res.json?.data?.addressStatus === 'PENDING',
    res.json
  );
  return res.json.data;
};
const a1 = await addRobot(acme.admin.cookie, 'Forklift A1', mockIp('a1'));
const a2 = await addRobot(acme.admin.cookie, 'Forklift A2', mockIp('a2'));
const b1 = await addRobot(beta.admin.cookie, 'Tugger B1', mockIp('b1'));
await sleep(2500);
for (const r of ['a1', 'a2', 'b1'] as const) {
  const s = await stats(r);
  check(
    `${r}: zero connections before approval`,
    Object.values(s.everConnected).every(n => n === 0),
    s.everConnected
  );
}
const queue = (await call('/api/staff/addresses?status=PENDING', { cookie: staff.cookie })).json
  .data;
check('staff see three requests', queue.length === 3, queue);
for (const entry of queue) {
  const res = await call(`/api/staff/addresses/${entry.id}/approve`, {
    cookie: staff.cookie,
    method: 'POST',
  });
  check(`approve ${entry.ip}`, res.status === 200, res.json);
}
for (const r of ['a1', 'a2', 'b1'] as const) {
  const connected = await waitFor(async () => {
    const s = await stats(r);
    return s.connections[9090] >= 2 && s.connections[9487] >= 1 && s.connections[8766] >= 1 && s;
  }, 20000);
  check(
    `${r}: backend connected to all bridges`,
    connected,
    connected ? '' : (await stats(r)).connections
  );
}
const subscribed = (await stats('a1')).received.subscribed;
const expected: Record<string, string> = {
  '/odom_ui': 'nav_msgs/msg/Odometry',
  '/scan_ui': 'sensor_msgs/msg/LaserScan',
  '/scan_pose_ui': 'geometry_msgs/msg/PoseStamped',
  '/plan_ui': 'nav_msgs/msg/Path',
  '/amcl_pose_ui': 'geometry_msgs/msg/PoseWithCovarianceStamped',
  '/tf_ui': 'tf2_msgs/msg/TFMessage',
  '/tf_static_ui': 'tf2_msgs/msg/TFMessage',
};
for (const [topic, type] of Object.entries(expected)) {
  check(
    `backend subscribes ${topic} as ${type}`,
    subscribed.some((s: any) => s.topic === topic && s.type === type),
    subscribed
  );
}

Object.assign(state, {
  staff,
  acme: acme.admin,
  beta: beta.admin,
  acmeOp,
  betaOp,
  acmeOrg: acme.org.id,
  betaOrg: beta.org.id,
  a1: a1.id,
  a2: a2.id,
  b1: b1.id,
});
saveState();
finish();
