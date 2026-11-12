// Sends the same commands straight to the real robot Python and to the mock, and compares every
// frame: event, status, message wording, and each field's type. No backend involved.
const TARGETS = {
  real: { mission: 19487, emergency: 18766, mapping: 18765, control: 19004 },
  mock: { mission: 19488, emergency: 18767, mapping: 18768, control: 19005 },
};
type Target = keyof typeof TARGETS;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const typeOf = (value: unknown): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return value.length ? `array<${typeOf(value[0])}>` : 'array';
  if (typeof value === 'object') return `{${shape(value as object)}}`;
  return typeof value;
};
const shape = (value: object) =>
  Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${key}:${typeOf(entry)}`)
    .join(',');
const signature = (frame: any) => {
  const payload = frame?.payload ?? {};
  const message = typeof payload.message === 'string' ? payload.message : '';
  return `${frame?.event} status=${payload.status ?? ''} requestId=${payload.requestId ?? ''} msg="${message}" [${shape(payload)}]`;
};

const open = (port: number) =>
  new Promise<{ ws: WebSocket; frames: any[] }>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const frames: any[] = [];
    ws.addEventListener('message', event => {
      try {
        frames.push(JSON.parse(String(event.data)));
      } catch {
        frames.push({ event: 'UNPARSABLE' });
      }
    });
    ws.addEventListener('open', () => resolve({ ws, frames }));
    ws.addEventListener('error', () => reject(new Error(`cannot connect to ${port}`)));
  });

const run = async (name: Target) => {
  const ports = TARGETS[name];
  const steps: { step: string; frames: string[] }[] = [];
  const mission = await open(ports.mission);
  const emergency = await open(ports.emergency);
  const mapping = await open(ports.mapping);
  const hw = (on: number) => fetch(`http://127.0.0.1:${ports.control}/hw?on=${on}`);
  // The 30s status tick runs on each robot's own clock, so it can land in any step; its shape is
  // compared in the first step.
  const take = (step: string, source: { frames: any[] }) => {
    const frames =
      steps.length === 0
        ? source.frames
        : source.frames.filter(f => f.event !== 'ROBOT_STATUS_UPDATE');
    steps.push({ step, frames: frames.map(signature).sort() });
    source.frames.length = 0;
  };
  const missionStep = async (step: string, send: string | object | null, waitMs = 400) => {
    if (send !== null) mission.ws.send(typeof send === 'string' ? send : JSON.stringify(send));
    await sleep(waitMs);
    take(`mission: ${step}`, mission);
  };
  const emergencyStep = async (step: string, send: string | object | null, waitMs = 300) => {
    if (send !== null) emergency.ws.send(typeof send === 'string' ? send : JSON.stringify(send));
    await sleep(waitMs);
    take(`emergency: ${step}`, emergency);
  };
  const cmd = (event: string, payload: object = {}) => ({ event, payload });

  await sleep(300);
  await missionStep('status update on connect', null);
  await emergencyStep('state on connect', null);
  await missionStep('invalid JSON', 'not json');
  await missionStep('unknown event', cmd('FLY_AWAY', { requestId: 'r0' }));
  await missionStep('SHOW_UP no id', cmd('SHOW_UP', { requestId: 'r1' }));
  await missionStep('SHOW_UP bad id', cmd('SHOW_UP', { missionId: 'abc', requestId: 'r2' }));
  await missionStep('SHOW_UP unknown mission', cmd('SHOW_UP', { missionId: 999, requestId: 'r3' }));
  await missionStep('SHOW_UP mission 1', cmd('SHOW_UP', { missionId: '1', requestId: 'r4' }));
  await missionStep('SHOW_UP mission on map1', cmd('SHOW_UP', { missionId: 3, requestId: 'r5' }));
  await missionStep('START no id', cmd('START_MISSION', { requestId: 'r6' }));
  await missionStep('START unknown', cmd('START_MISSION', { missionId: 999, requestId: 'r7' }));
  await missionStep('PAUSE nothing running', cmd('PAUSE_MISSION', { requestId: 'r8' }));
  await missionStep('RESUME nothing running', cmd('RESUME_MISSION', { requestId: 'r9' }));
  await missionStep('CANCEL nothing running', cmd('CANCEL_MISSION', { requestId: 'r10' }));

  await missionStep(
    'START mission 1',
    cmd('START_MISSION', { missionId: 1, requestId: 's1' }),
    300
  );
  await missionStep(
    'second START refused',
    cmd('START_MISSION', { missionId: 1, requestId: 's2' }),
    200
  );
  await missionStep('first waypoint', null, 900);
  await missionStep(
    'PAUSE wrong mission',
    cmd('PAUSE_MISSION', { missionId: 2, requestId: 'p0' }),
    200
  );
  await missionStep('PAUSE', cmd('PAUSE_MISSION', { missionId: 1, requestId: 'p1' }), 500);
  await missionStep('PAUSE again', cmd('PAUSE_MISSION', { missionId: 1, requestId: 'p2' }), 200);
  await missionStep(
    'RESUME wrong mission',
    cmd('RESUME_MISSION', { missionId: 2, requestId: 'p3' }),
    200
  );
  await missionStep('RESUME', cmd('RESUME_MISSION', { missionId: 1, requestId: 'p4' }), 200);
  await missionStep(
    'RESUME while running',
    cmd('RESUME_MISSION', { missionId: 1, requestId: 'p5' }),
    200
  );
  await missionStep('runs to completion', null, 3800);

  await missionStep(
    'START for cancel',
    cmd('START_MISSION', { missionId: 1, requestId: 'c1' }),
    1400
  );
  await missionStep(
    'CANCEL wrong mission',
    cmd('CANCEL_MISSION', { missionId: 2, requestId: 'c2' }),
    200
  );
  await missionStep('CANCEL', cmd('CANCEL_MISSION', { missionId: 1, requestId: 'c3' }), 600);

  await missionStep(
    'START for pause+cancel',
    cmd('START_MISSION', { missionId: 1, requestId: 'd1' }),
    500
  );
  await missionStep('PAUSE before cancel', cmd('PAUSE_MISSION', { requestId: 'd2' }), 500);
  await missionStep(
    'CANCEL while paused: watchdog',
    cmd('CANCEL_MISSION', { requestId: 'd3' }),
    3600
  );

  await missionStep('teleop', cmd('CHANGE_MODE', { targetMode: 'teleopActive', requestId: 'm1' }));
  await missionStep('teleop again', cmd('CHANGE_MODE', { targetMode: 'teleop' }));
  await missionStep('bad mode', cmd('CHANGE_MODE', { targetMode: 'warp' }));
  await missionStep('no mode', cmd('CHANGE_MODE'));
  await missionStep('autonomous', cmd('CHANGE_MODE', { targetMode: 'autonomousActive' }));
  await missionStep(
    'START for teleop kill',
    cmd('START_MISSION', { missionId: 1, requestId: 't1' }),
    500
  );
  await missionStep('teleop during a mission', cmd('CHANGE_MODE', { targetMode: 'teleop' }), 1200);
  await missionStep('back to autonomous', cmd('CHANGE_MODE', { targetMode: 'auto' }));

  await emergencyStep('invalid JSON ignored', 'not json');
  await emergencyStep('unknown event ignored', cmd('NOPE'));
  await emergencyStep('software e-stop on while idle', cmd('SOFTWARE_EMERGENCY', { status: true }));
  await missionStep(
    'START refused while idle in e-stop',
    cmd('START_MISSION', { missionId: 1, requestId: 'i1' }),
    200
  );
  await missionStep(
    'RESUME refused while idle in e-stop',
    cmd('RESUME_MISSION', { missionId: 1, requestId: 'i2' }),
    200
  );
  await emergencyStep(
    'software e-stop off while idle',
    cmd('SOFTWARE_EMERGENCY', { status: false })
  );
  await missionStep(
    'START for e-stop',
    cmd('START_MISSION', { missionId: 1, requestId: 'e1' }),
    1400
  );
  await emergencyStep('software e-stop on', cmd('SOFTWARE_EMERGENCY', { status: true }));
  await missionStep('auto pause', null, 500);
  await emergencyStep('software e-stop on again', cmd('SOFTWARE_EMERGENCY', { status: true }));
  await missionStep(
    'START refused while auto-paused',
    cmd('START_MISSION', { missionId: 1, requestId: 'e2' }),
    200
  );
  await missionStep(
    'RESUME refused while auto-paused',
    cmd('RESUME_MISSION', { missionId: 1, requestId: 'e3' }),
    200
  );
  await emergencyStep('software e-stop off', cmd('SOFTWARE_EMERGENCY', { status: false }));
  await missionStep('auto resume', null, 400);
  await missionStep('hardware e-stop', null, 100);
  await hw(1);
  await emergencyStep('hardware on', null, 400);
  await missionStep('auto pause by hardware', null, 400);
  await hw(0);
  await emergencyStep('hardware off', null, 400);
  await missionStep('auto resume after hardware', null, 400);
  await missionStep('finishes', null, 4000);

  mapping.ws.send('not json');
  await sleep(300);
  steps.push({ step: 'mapping: invalid JSON', frames: mapping.frames.map(signature) });
  mapping.frames.length = 0;
  mapping.ws.send(JSON.stringify(cmd('NOPE')));
  await sleep(300);
  steps.push({ step: 'mapping: unknown event', frames: mapping.frames.map(signature) });
  mapping.frames.length = 0;
  mapping.ws.send(JSON.stringify(cmd('GET_MAP_DATA')));
  await sleep(1500);
  const response = mapping.frames[0];
  steps.push({ step: 'mapping: GET_MAP_DATA', frames: mapping.frames.map(signature) });

  mission.ws.close();
  emergency.ws.close();
  mapping.ws.close();
  return { steps, response };
};

const [real, mock] = await Promise.all([run('real'), run('mock')]);
let same = 0;
let different = 0;
for (let i = 0; i < real.steps.length; i += 1) {
  const a = real.steps[i];
  const b = mock.steps[i];
  if (JSON.stringify(a.frames) === JSON.stringify(b.frames)) {
    same += 1;
    continue;
  }
  different += 1;
  console.log(`\nDIFF  ${a.step}`);
  for (const frame of a.frames)
    if (!b.frames.includes(frame)) console.log(`  real: ${frame.slice(0, 460)}`);
  for (const frame of b.frames)
    if (!a.frames.includes(frame)) console.log(`  mock: ${frame.slice(0, 460)}`);
}
const rf = real.response?.payload?.files ?? {};
const mf = mock.response?.payload?.files ?? {};
console.log(
  '\nmap files identical:',
  rf.map_pgm_content === mf.map_pgm_content,
  rf.map_yaml_content === mf.map_yaml_content,
  JSON.stringify(rf.metadata_json) === JSON.stringify(mf.metadata_json)
);
console.log(
  'additional maps real:',
  (rf.additional_maps ?? []).map((m: any) => m.name),
  'mock:',
  (mf.additional_maps ?? []).map((m: any) => m.name)
);
console.log(`\nRESULT: ${real.steps.length} steps, ${same} identical, ${different} different`);
console.log(
  'total frames compared:',
  real.steps.reduce((n, s) => n + s.frames.length, 0)
);
process.exit(different ? 1 : 0);
