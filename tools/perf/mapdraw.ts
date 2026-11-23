// Map draw harness for the eng perf ledger: cost per frame of the dashboard map's scene
// (mapdraw.page.tsx) in headless Chrome at device scale 2, while every robot moves and a new laser
// scan arrives each frame (telemetry), and while the view pans and zooms (panzoom).
// frame_ms is main-thread work per frame; frame_interval_ms is wall time per frame (16.7 at 60 fps),
// which also catches raster and compositing. Each run reports six 100-frame windows.
// Needs Google Chrome (see chrome.ts); no running stack.
// bun tools/perf/mapdraw.ts <current|laser|tuned|imperative|canvas2d> [dashboard|stress]
import { join } from 'node:path';
import { devtools, launch } from './chrome.ts';

const CANDIDATES = ['current', 'laser', 'tuned', 'imperative', 'canvas2d'];
const candidate = process.argv[2] ?? 'current';
if (!CANDIDATES.includes(candidate)) throw new Error(`use one of ${CANDIDATES.join(', ')}`);
const scene = process.argv[3] ?? 'dashboard';
if (!['dashboard', 'stress'].includes(scene)) throw new Error('scene is dashboard or stress');
const unit = scene === 'stress' ? 'dashboard-ui:map-draw@stress' : 'dashboard-ui:map-draw';
const WARMUP_FRAMES = 60;
const WINDOWS = 6;
const WINDOW_FRAMES = 100;

const build = await Bun.build({
  entrypoints: [join(import.meta.dir, 'mapdraw.page.tsx')],
  target: 'browser',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
});
if (!build.success) throw new AggregateError(build.logs, 'the bench page failed to build');
const script = await build.outputs[0]?.text();
const html =
  '<!doctype html><body style="margin:0"><div id="root"></div><script type="module" src="/bench.js"></script>';
const server = Bun.serve({
  port: 0,
  fetch: request =>
    new URL(request.url).pathname === '/bench.js'
      ? new Response(script, { headers: { 'content-type': 'text/javascript' } })
      : new Response(html, { headers: { 'content-type': 'text/html' } }),
});

const chrome = await launch(['--force-device-scale-factor=2']);
try {
  const page = await devtools(chrome.url);
  await page.send('Page.enable');
  await page.send('Performance.enable');
  const evaluate = async (expression: string) => {
    const { result, exceptionDetails } = await page.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? expression);
    return result.value;
  };
  const loaded = page.next('Page.loadEventFired');
  await page.send('Page.navigate', {
    url: `http://127.0.0.1:${server.port}/?c=${candidate}&scene=${scene}`,
  });
  await loaded;
  const deadline = Date.now() + 10_000;
  while (!(await evaluate('window.__ready === true'))) {
    if (Date.now() > deadline) throw new Error(`${candidate} never became ready`);
    await Bun.sleep(50);
  }
  const taskSeconds = async () => {
    const { metrics } = await page.send('Performance.getMetrics');
    return metrics.find((metric: { name: string }) => metric.name === 'TaskDuration').value;
  };
  const report = (metric: string, value: number) =>
    console.log(
      JSON.stringify({ unit, metric, value: Number(value.toFixed(3)), env: 'lab-desktop' })
    );
  for (const scenario of ['telemetry', 'panzoom']) {
    await evaluate(`__run('${scenario}', ${WARMUP_FRAMES}, 0)`);
    for (let window = 0; window < WINDOWS; window += 1) {
      const before = await taskSeconds();
      const start = WARMUP_FRAMES + window * WINDOW_FRAMES;
      const { frames, ms } = await evaluate(`__run('${scenario}', ${WINDOW_FRAMES}, ${start})`);
      const busy = (await taskSeconds()) - before;
      report(`${scenario}_frame_ms`, (busy * 1000) / frames);
      report(`${scenario}_frame_interval_ms`, ms / frames);
    }
  }
} finally {
  await chrome.close();
  server.stop(true);
}
