// Headless Google Chrome over the DevTools protocol, for the perf harnesses. CHROME overrides its path.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME =
  process.env['CHROME'] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export const launch = async (extraArgs: string[] = []) => {
  const dir = mkdtempSync(join(tmpdir(), 'chrome-perf-'));
  const chrome = Bun.spawn(
    [
      CHROME,
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${dir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1440,900',
      ...extraArgs,
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

export const devtools = async (url: string) => {
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
