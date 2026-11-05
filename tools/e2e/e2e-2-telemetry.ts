// Telemetry and teleop: robot -> backend -> dashboard socket, and back.
import {
  backendLogs,
  check,
  ctl,
  finish,
  note,
  openSocket,
  section,
  sleep,
  state,
  stats,
  waitFor,
} from './e2e-lib';

const { acme, acmeOp, beta, a1, a2, b1 } = state;

section('telemetry reaches the owner, with the fields the UI reads');
const tel = await openSocket(`/ws/robots/${a1}/telemetry/e2e`, acmeOp.cookie);
const odom = await tel.waitChannel('odom');
check('odom arrives', odom);
check(
  'odom has pose.pose.position and orientation',
  odom && (odom as any).data?.pose?.pose?.position && (odom as any).data?.pose?.pose?.orientation,
  odom
);
const laser = (await tel.waitChannel('laser')) as any;
check('laser arrives', laser);
check(
  'laser keeps angle_min/increment and ranges',
  laser && Array.isArray(laser.data.ranges) && typeof laser.data.angle_increment === 'number',
  laser?.data && Object.keys(laser.data)
);
check(
  'laser has frame and stamp',
  laser?.data.frame && laser.data.stampMs,
  laser?.data && { frame: laser.data.frame, stampMs: laser.data.stampMs }
);
const nullRanges = laser?.data?.ranges?.filter((r: unknown) => r === null).length;
note(`laser: ${laser?.data?.ranges?.length} points, ${nullRanges} null (rosbridge inf/NaN)`);
check(
  'the simulated lidar hits walls on the map',
  laser?.data?.ranges?.some((r: unknown) => typeof r === 'number'),
  nullRanges
);
check('amcl arrives', await tel.waitChannel('amcl'));
const withScanPose = await tel.waitChannel('laser', d => d.scanPose);
check(
  'laser carries the scan pose matched by stamp',
  withScanPose,
  tel.channel('laser').at(-1)?.data?.scanPoseSource
);
check('waypoints arrives', await tel.waitChannel('waypoints'));
const poseEvent = (await tel.waitChannel('pose')) as any;
check('computed pose arrives', poseEvent, tel.received.map(m => m.channel).slice(0, 20));
if (poseEvent) note(`pose payload keys: ${Object.keys(poseEvent.data)}`);
const channels = [...new Set(tel.received.map(m => m.channel))];
note(`channels seen: ${channels}`);

section('teleop: limits and watchdog');
await ctl('a1', '/reset');
tel.send({
  type: 'command',
  channel: 'teleop',
  commandId: 't1',
  data: { linear: { x: 5, y: 0, z: 0 }, angular: { x: 0, y: 0, z: -9 } },
});
const clamped = await waitFor(async () => (await stats('a1')).received.cmdVel[0]);
check(
  'a teleop command reaches /cmd_vel_ui',
  clamped,
  await stats('a1').then(s => s.received.advertised)
);
check('linear is clamped to 0.5', (clamped as any)?.msg?.linear?.x === 0.5, clamped);
check('angular is clamped to -0.8', (clamped as any)?.msg?.angular?.z === -0.8, clamped);
const zero = await waitFor(async () => {
  const list = (await stats('a1')).received.cmdVel;
  return list.find((c: any) => c.msg.linear.x === 0 && c.msg.angular.z === 0);
}, 3000);
check('the watchdog zeroes the robot when commands stop', zero);
if (zero && clamped) {
  const gap = (zero as any).t - (clamped as any).t;
  check(`watchdog fired about 750ms later (${gap}ms)`, gap >= 650 && gap <= 1500, gap);
}
const advertised = (await stats('a1')).received.advertised;
check(
  'teleop is advertised as geometry_msgs/msg/Twist',
  advertised.some((a: any) => a.topic === '/cmd_vel_ui' && a.type === 'geometry_msgs/msg/Twist'),
  advertised
);

tel.clear();
for (const [label, data] of [
  ['string', 'fast please'],
  ['null', null],
  ['array', []],
  ['NaN-like', { linear: { x: 'NaN' } }],
] as const) {
  tel.send({ type: 'command', channel: 'teleop', commandId: `bad-${label}`, data });
}
await sleep(500);
const before = (await stats('a1')).received.cmdVel.filter(
  (c: any) => c.msg.linear.x !== 0 || c.msg.angular.z !== 0
).length;
note(
  `non-zero cmd_vel after malformed teleop: ${before} (was 1), errors returned: ${tel.received.filter(m => m.type === 'error').length}`
);
check(
  'malformed teleop never moves the robot',
  before === 1,
  (await stats('a1')).received.cmdVel.slice(-5)
);

tel.clear();
tel.send({ type: 'command', channel: 'odom', data: {} });
tel.send({ type: 'command', channel: 'nope', data: {} });
tel.send('not json');
tel.send({ type: 'request', channel: 'asset' });
tel.send({ type: 'weird' });
await sleep(400);
check(
  'publishing to a subscribe-only channel is refused',
  tel.received.some(m => m.type === 'error' && /not publishable/.test(m.message)),
  tel.received
);
check(
  'an unknown channel is refused',
  tel.received.some(m => m.type === 'error' && /Unknown channel/.test(m.message)),
  tel.received
);
check(
  'invalid JSON is refused without closing the socket',
  tel.received.some(m => m.type === 'error' && /Invalid JSON/.test(m.message)) &&
    tel.closeCode() === null,
  tel.received
);

section('initial pose');
await ctl('a1', '/reset');
const initial = {
  header: { frame_id: 'map', stamp: { sec: 0, nanosec: 0 } },
  pose: {
    pose: { position: { x: 1.5, y: -2.5, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
    covariance: new Array(36).fill(0),
  },
};
tel.send({ type: 'command', channel: 'initialpose', commandId: 'i1', data: initial });
const gotPose = await waitFor(async () => (await stats('a1')).received.initialPose[0]);
check(
  'initial pose reaches /initialpose_ui',
  (gotPose as any)?.pose?.pose?.position?.x === 1.5,
  gotPose
);
const moved = await tel.waitChannel(
  'amcl',
  d => Math.abs((d.pose?.pose?.position?.x ?? 0) - 1.5) < 0.01
);
check(
  'the robot’s new position comes back through telemetry',
  moved,
  tel.channel('amcl').slice(-1)
);
const adv2 = (await stats('a1')).received.advertised.find(
  (a: any) => a.topic === '/initialpose_ui'
);
check('initial pose is latched', adv2?.latch === true, adv2);

section('live isolation between robots and orgs');
const acmeTwo = await openSocket(`/ws/robots/${a2}/telemetry/e2e`, acme.cookie);
const betaSock = await openSocket(`/ws/robots/${b1}/telemetry/e2e`, beta.cookie);
tel.clear();
await ctl('a1', '/reset');
await ctl('a2', '/reset');
await ctl('b1', '/reset');
const moveBeta = {
  type: 'command',
  channel: 'teleop',
  commandId: 'b',
  data: { linear: { x: 0.3, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } },
};
betaSock.send(moveBeta);
await waitFor(async () => (await stats('b1')).received.cmdVel.length > 0);
await sleep(300);
const [sa1, sa2, sb1] = await Promise.all([stats('a1'), stats('a2'), stats('b1')]);
check(
  'Beta’s teleop reaches only Beta’s robot',
  sb1.received.cmdVel.length > 0 &&
    sa1.received.cmdVel.length === 0 &&
    sa2.received.cmdVel.length === 0,
  [sa1.received.cmdVel.length, sa2.received.cmdVel.length, sb1.received.cmdVel.length]
);
await tel.waitChannel('amcl');
const acmePos = tel.channel('amcl').at(-1)?.data?.pose?.pose?.position;
await sleep(600);
const betaPos = betaSock.channel('amcl').at(-1)?.data?.pose?.pose?.position;
check('Beta’s socket shows Beta’s robot, not Acme’s', betaPos && Math.abs(betaPos.x - 1.5) > 0.2, {
  acmePos,
  betaPos,
});
const a2Pos = acmeTwo.channel('amcl').at(-1)?.data?.pose?.pose?.position;
check('Acme’s second robot is its own stream', a2Pos && Math.abs(a2Pos.x - 1.5) > 0.2, {
  acmePos,
  a2Pos,
});

let crossHandshake = 'opened';
try {
  await openSocket(`/ws/robots/${a1}/telemetry/e2e`, beta.cookie);
} catch {
  crossHandshake = 'refused';
}
check('Beta cannot open a telemetry socket on Acme’s robot', crossHandshake === 'refused');

section('a slow or absent dashboard does not hurt the robot');
tel.close();
acmeTwo.close();
betaSock.close();
await sleep(500);
const s = await stats('a1');
check(
  'robot connections stay up after dashboards leave',
  s.connections[9090] >= 2 && s.connections[9487] >= 1,
  s.connections
);
check(
  'no backend exception so far',
  !/TypeError|ReferenceError|Unhandled/.test(backendLogs('3m')),
  backendLogs('3m').match(/.*(TypeError|ReferenceError|Unhandled).*/)?.[0]
);
finish();
