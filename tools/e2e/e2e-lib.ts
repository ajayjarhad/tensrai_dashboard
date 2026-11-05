// Shared helpers for the end-to-end checks: everything goes through nginx, the way a browser does.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const S = import.meta.dir;
export const WEB = process.env.E2E_WEB ?? 'http://127.0.0.1:18080';
export const WS_BASE = WEB.replace(/^http/, 'ws');
export const IS_TLS = WEB.startsWith('https');
export const REPO = resolve(import.meta.dir, '../..');
export const COMPOSE = [
  'compose',
  '-p',
  'dashboard-e2e',
  '-f',
  'docker-compose.yml',
  '-f',
  `${S}/compose-verify.yml`,
  ...(IS_TLS ? ['-f', `${S}/compose-tls.yml`] : []),
];
mkdirSync(`${S}/.out`, { recursive: true });
const STATE = `${S}/.out/state.json`;

let passed = 0;
let failed = 0;
export const failures: string[] = [];
export const check = (name: string, ok: unknown, detail: unknown = '') => {
  if (ok) passed += 1;
  else {
    failed += 1;
    failures.push(name);
  }
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `   ${JSON.stringify(detail)?.slice(0, 500)}`}`
  );
};
export const note = (text: string) => console.log(`NOTE  ${text}`);
export const section = (name: string) => console.log(`\n--- ${name}`);
export const finish = () => {
  console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
  if (failures.length) console.log(`FAILED:\n  ${failures.join('\n  ')}`);
  process.exit(failed ? 1 : 0);
};
export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export const waitFor = async <T>(fn: () => T | Promise<T>, ms = 15000): Promise<T | false> => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const value = await fn();
    if (value) return value;
    await sleep(150);
  }
  return false;
};
export const sh = (args: string[]) => {
  const r = Bun.spawnSync(args, { cwd: REPO });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
};
export const mongo = (js: string) =>
  sh([
    'docker',
    'exec',
    'dashboard-e2e-mongo-1',
    'mongosh',
    '--quiet',
    'tensrai_dashboard',
    '--eval',
    js,
  ]).out.trim();
export const mongoJson = (js: string) => JSON.parse(mongo(`EJSON.stringify(${js})`));
export const backendLogs = (since = '2m') =>
  sh(['docker', 'logs', '--since', since, 'dashboard-e2e-backend-1']).out;

export const state: any = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
export const saveState = () => writeFileSync(STATE, JSON.stringify(state, null, 1));

export const call = async (
  path: string,
  opts: { cookie?: string; method?: string; body?: unknown; raw?: boolean } = {}
) => {
  const res = await fetch(`${WEB}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (opts.raw) {
    return {
      status: res.status,
      headers: res.headers,
      bytes: new Uint8Array(await res.arrayBuffer()),
      json: null as any,
      cookie: '',
    };
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return {
    status: res.status,
    json,
    text,
    headers: res.headers,
    cookie: (res.headers.get('set-cookie') ?? '').split(';')[0],
  };
};
export const signIn = (username: string, password: string) =>
  call('/api/auth/sign-in', { method: 'POST', body: { username, password } });
export const finishSetup = async (username: string, temp: string) => {
  const first = await signIn(username, temp);
  const password = `Pw-${crypto.randomUUID().slice(0, 12)}`;
  const done = await call('/api/auth/first-time-setup', {
    cookie: first.cookie,
    method: 'POST',
    body: { tempPassword: temp, newPassword: password, confirmPassword: password },
  });
  if (!done.json?.success)
    throw new Error(`setup failed for ${username}: ${JSON.stringify(done.json)}`);
  const session = await signIn(username, password);
  return { username, password, cookie: session.cookie };
};

// A dashboard socket that keeps everything it receives.
export const openSocket = async (path: string, cookie: string) => {
  const socket = new WebSocket(`${WS_BASE}${path}`, {
    headers: { cookie },
    tls: { rejectUnauthorized: false },
  } as any);
  const received: any[] = [];
  let closeCode: number | null = null;
  socket.addEventListener('message', event => {
    try {
      received.push(JSON.parse(String(event.data)));
    } catch {
      received.push({ unparsable: String(event.data).slice(0, 100) });
    }
  });
  socket.addEventListener('close', event => {
    closeCode = event.code;
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve);
    socket.addEventListener('error', () => reject(new Error(`socket failed: ${path}`)));
  });
  return {
    socket,
    received,
    send: (message: unknown) =>
      socket.send(typeof message === 'string' ? message : JSON.stringify(message)),
    closeCode: () => closeCode,
    close: () => socket.close(),
    clear: () => {
      received.length = 0;
    },
    events: (event: string) => received.filter(m => m.event === event),
    channel: (channel: string) => received.filter(m => m.type === 'event' && m.channel === channel),
    waitEvent: (event: string, match: (payload: any) => boolean = () => true, ms = 12000) =>
      waitFor(() => received.find(m => m.event === event && match(m.payload)), ms),
    waitChannel: (channel: string, match: (data: any) => boolean = () => true, ms = 12000) =>
      waitFor(
        () => received.find(m => m.type === 'event' && m.channel === channel && match(m.data)),
        ms
      ),
  };
};

export const MOCK = { a1: 19001, a2: 19002, b1: 19003 } as const;
export type MockName = keyof typeof MOCK;
export const ctl = async (robot: MockName, path: string, body?: string) => {
  const res = await fetch(
    `http://127.0.0.1:${MOCK[robot]}${path}`,
    body ? { method: 'POST', body } : {}
  );
  return res.text();
};
export const stats = async (robot: MockName) =>
  (await fetch(`http://127.0.0.1:${MOCK[robot]}/stats`)).json() as Promise<any>;
export const mockIp = (robot: MockName) =>
  sh([
    'docker',
    'inspect',
    '-f',
    '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',
    `mock-${robot}`,
  ]).out.trim();
export const robotPorts = {
  bridgePort: 9090,
  mappingBridgePort: 8765,
  missionBridgePort: 9487,
  emergencyBridgePort: 8766,
};
