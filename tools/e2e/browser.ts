// A signed-in headless Chrome tab for the browser checks: signs in through the API (passwords never
// leave the test state), loads "/" once like a returning user, then visits and evaluates.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { devtools, launch } from '../perf/chrome.ts';
import { REPO, signIn, sleep, WEB } from './e2e-lib.ts';

const OUT = join(import.meta.dir, '.out');

export const browserSession = async (account: { username: string; password: string }) => {
  const { cookie } = await signIn(account.username, account.password);
  const chrome = await launch();
  const page = await devtools(chrome.url);
  await page.send('Page.enable');
  const split = cookie.indexOf('=');
  await page.send('Network.setCookie', {
    name: cookie.slice(0, split),
    value: cookie.slice(split + 1),
    url: WEB,
  });
  // The app saves the sign-in on its first load, so deep links work after it.
  const visit = async (path: string) => {
    const loaded = page.next('Page.loadEventFired');
    await page.send('Page.navigate', { url: new URL(path, WEB).href });
    await loaded;
    await sleep(2500);
  };
  const evaluate = async <T>(expression: string): Promise<T> =>
    (await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))
      .result.value as T;
  const screenshot = async (name: string) => {
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  };
  // Picks files for an <input type="file"> as a person would, firing its change event.
  const chooseFiles = async (selector: string, files: string[]) => {
    const { root } = await page.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await page.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    await page.send('DOM.setFileInputFiles', { nodeId, files });
  };
  await visit('/');
  return { page, visit, evaluate, screenshot, chooseFiles, close: chrome.close };
};

// map1.yaml with its origin nudged for this run, so an upload is never refused as a duplicate of a
// map the suites or an earlier check already stored.
export const uniqueYaml = (name: string) => {
  const nudge = ((Date.now() % 997) + 1) * 0.001;
  const yaml = readFileSync(join(REPO, 'dashboard_ros/maps/map1.yaml'), 'utf8').replace(
    /origin: \[(-?[\d.]+),/,
    (_match, x) => `origin: [${(Number(x) + nudge).toFixed(3)},`
  );
  const path = join(OUT, `${name}.yaml`);
  writeFileSync(path, yaml);
  return path;
};
