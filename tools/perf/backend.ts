// Backend harness for the eng perf ledger, against a running stack (tools/e2e/run.sh --keep):
// latency of the API calls a dashboard load makes, and backend CPU while live telemetry fans out
// to two viewers per robot. Signs in with PERF_USERNAME/PERF_PASSWORD, else the e2e org admin.
// bun tools/perf/backend.ts
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WEB = process.env['E2E_WEB'] ?? 'http://127.0.0.1:18080';
const CONTAINER = process.env['PERF_CONTAINER'] ?? 'dashboard-e2e-backend-1';
const SAMPLES = 20;

const e2eState = resolve(import.meta.dir, '../e2e/.out/state.json');
const acme = existsSync(e2eState) ? JSON.parse(readFileSync(e2eState, 'utf8')).acme : {};
const username = process.env['PERF_USERNAME'] ?? acme.username;
const password = process.env['PERF_PASSWORD'] ?? acme.password;

const signIn = await fetch(`${WEB}/api/auth/sign-in`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username, password }),
});
if (!signIn.ok) throw new Error(`sign-in: HTTP ${signIn.status}`);
const cookie = (signIn.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
const get = (path: string) => fetch(`${WEB}/api/${path}`, { headers: { cookie } });
const sample = (unit: string, metric: string, value: number) =>
  console.log(JSON.stringify({ unit, metric, value, env: 'local' }));

const robots: Array<{ id: string; mapId?: string | null }> = (await (await get('robots')).json())
  .data;
const mapId = robots.find(robot => robot.mapId)?.mapId;
const routes = ['robots', 'maps', 'mission-runs?limit=100', ...(mapId ? [`maps/${mapId}`] : [])];

for (const route of routes) {
  const unit = `backend:GET /api/${route.replace(/[0-9a-f]{24}/, ':id')}`;
  for (let i = 0; i < SAMPLES; i++) {
    const start = performance.now();
    const response = await get(route);
    await response.arrayBuffer();
    if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
    sample(unit, 'latency_ms', Math.round((performance.now() - start) * 100) / 100);
  }
}

const wsBase = WEB.replace(/^http/, 'ws');
const viewers = [...robots, ...robots].map(
  (robot, i) =>
    new WebSocket(`${wsBase}/ws/robots/${robot.id}/telemetry/perf-${i}`, {
      headers: { cookie },
    } as unknown as string[])
);
await Bun.sleep(3000);
for (let i = 0; i < 10; i++) {
  const stats = Bun.spawnSync([
    'docker',
    'stats',
    '--no-stream',
    '--format',
    '{{.CPUPerc}}',
    CONTAINER,
  ]);
  const percent = Number.parseFloat(stats.stdout.toString());
  if (Number.isFinite(percent)) sample('backend:telemetry fan-out', 'cpu_ratio', percent / 100);
}
for (const viewer of viewers) viewer.close();
