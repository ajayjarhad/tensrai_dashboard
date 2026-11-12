// Paint harness for the eng perf ledger: LCP and total blocking time in headless Chrome under
// Lighthouse's throttling, with an empty cache, for a first visit to the sign-in page and for a
// signed-in operator's visit to the dashboard.
// Needs a running stack (tools/e2e/run.sh --keep) and Google Chrome; CHROME overrides its path.
// bun tools/perf/paint.ts [desktop|mobile]
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signIn, sleep, state, WEB } from '../e2e/e2e-lib.ts';

const CHROME =
  process.env['CHROME'] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// Lighthouse's presets as DevTools applies them: the mobile RTT is scaled by 3.75 and its throughput
// by 0.9 to stand in for the simulation Lighthouse runs by default.
const PROFILES = {
  desktop: { latency: 40, kbps: 10_240, cpuSlowdown: 1 },
  mobile: { latency: 562.5, kbps: 1_474.56, cpuSlowdown: 4 },
};
const profileName = (process.argv[2] ?? 'desktop') as keyof typeof PROFILES;
const profile = PROFILES[profileName];
if (!profile) throw new Error(`unknown profile ${profileName}; use desktop or mobile`);
const SETTLE_MS = 5_000;

const OBSERVE = `window.__paint = { lcp: 0, longTasks: [] };
new PerformanceObserver(list => { for (const e of list.getEntries()) window.__paint.lcp = e.startTime; })
  .observe({ type: 'largest-contentful-paint', buffered: true });
new PerformanceObserver(list => { for (const e of list.getEntries()) window.__paint.longTasks.push([e.startTime, e.duration]); })
  .observe({ type: 'longtask', buffered: true });`;

const launch = async () => {
  const dir = mkdtempSync(join(tmpdir(), 'paint-'));
  const chrome = Bun.spawn(
    [
      CHROME,
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${dir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1440,900',
      'about:blank',
    ],
    { stdout: 'ignore', stderr: 'pipe' }
  );
  const decoder = new TextDecoder();
  let banner = '';
  const stderr = chrome.stderr[Symbol.asyncIterator]();
  while (!/ws:\/\/\S+/.test(banner)) {
    const { value, done } = await stderr.next();
    if (done) throw new Error(`Chrome exited before DevTools was ready: ${banner}`);
    banner += decoder.decode(value);
  }
  // Keep draining so a chatty Chrome never blocks on a full pipe.
  void (async () => {
    while (!(await stderr.next()).done);
  })();
  const port = new URL(banner.match(/ws:\/\/\S+/)?.[0] ?? '').port;
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((target: { type: string }) => target.type === 'page');
  const close = async () => {
    chrome.kill();
    await chrome.exited;
    rmSync(dir, { recursive: true, force: true });
  };
  return { url: page.webSocketDebuggerUrl as string, close };
};

const devtools = async (url: string) => {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let lastId = 0;
  const replies = new Map<number, (message: any) => void>();
  const events = new Map<string, (params: any) => void>();
  ws.onmessage = event => {
    const message = JSON.parse(String(event.data));
    if (message.id) replies.get(message.id)?.(message);
    else events.get(message.method)?.(message.params);
  };
  const send = (method: string, params: object = {}) =>
    new Promise<any>((resolve, reject) => {
      lastId += 1;
      replies.set(lastId, message =>
        message.error
          ? reject(new Error(`${method}: ${message.error.message}`))
          : resolve(message.result)
      );
      ws.send(JSON.stringify({ id: lastId, method, params }));
    });
  const next = (method: string) => new Promise<any>(resolve => events.set(method, resolve));
  return { send, next };
};

const firstVisit = async (path: string, cookie?: string) => {
  const chrome = await launch();
  try {
    const page = await devtools(chrome.url);
    await page.send('Page.enable');
    await page.send('Network.enable');
    const bytesPerSecond = (profile.kbps * 1024) / 8;
    await page.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: profile.latency,
      downloadThroughput: bytesPerSecond,
      uploadThroughput: bytesPerSecond,
    });
    await page.send('Emulation.setCPUThrottlingRate', { rate: profile.cpuSlowdown });
    const visit = async () => {
      const loaded = page.next('Page.loadEventFired');
      await page.send('Page.navigate', { url: new URL(path, WEB).href });
      await loaded;
      await sleep(SETTLE_MS);
    };
    if (cookie) {
      const split = cookie.indexOf('=');
      await page.send('Network.setCookie', {
        name: cookie.slice(0, split),
        value: cookie.slice(split + 1),
        url: WEB,
      });
      // A returning operator after a deploy: the app has saved the sign-in, every file is new.
      await visit();
      await page.send('Network.clearBrowserCache');
    }
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: OBSERVE });
    await visit();
    const { result } = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `({ ...window.__paint, path: location.pathname,
        fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0 })`,
    });
    const paint = result.value as {
      lcp: number;
      fcp: number;
      path: string;
      longTasks: [number, number][];
    };
    if (paint.path !== path) throw new Error(`${path} landed on ${paint.path}`);
    // Lighthouse stops at time to interactive; counting to the end of the settle window can only add.
    const tbt = paint.longTasks
      .filter(([start]) => start >= paint.fcp)
      .reduce((total, [, duration]) => total + Math.max(0, duration - 50), 0);
    return { lcp: paint.lcp, tbt };
  } finally {
    await chrome.close();
  }
};

const operator = state.acme;
if (!operator) throw new Error('no e2e state; run tools/e2e/run.sh --keep first');
const session = await signIn(operator.username, operator.password);

const env = `lab-${profileName}`;
for (const [unit, path, cookie] of [
  ['dashboard-ui:/auth/login', '/auth/login', undefined],
  ['dashboard-ui:/', '/', session.cookie],
] as const) {
  const { lcp, tbt } = await firstVisit(path, cookie);
  console.log(JSON.stringify({ unit, metric: 'lcp_ms', value: Math.round(lcp), env }));
  console.log(JSON.stringify({ unit, metric: 'tbt_ms', value: Math.round(tbt), env }));
}
