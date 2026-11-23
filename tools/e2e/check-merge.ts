// Browser check for Merge maps against a running stack (tools/e2e/run.sh --keep): two copies of a
// map, one 5 m to the east, are lined up by two point pairs, nudged with the arrow keys and merged
// into a new map that carries both maps' tags. Screenshots land in tools/e2e/.out/merge-*.png.
//   bun tools/e2e/check-merge.ts
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { browserSession } from './browser.ts';
import { call, REPO, sleep, state } from './e2e-lib.ts';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `   ${detail}`}`);
};
const poll = async (test: () => Promise<boolean>, ms = 15_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(300))
    if (await test()) return true;
  return false;
};

const op = state.acmeOp.cookie;
type MapRow = { id: string; name: string; pixelWidth: number };
const listMaps = async (): Promise<MapRow[]> =>
  (await call('/api/maps', { cookie: op })).json?.data ?? [];
for (const leftover of (await listMaps()).filter(map => map.name.startsWith('Merge check'))) {
  await call(`/api/maps/${leftover.id}`, { cookie: state.acme.cookie, method: 'DELETE' });
}

const yaml = readFileSync(`${REPO}/dashboard_ros/maps/map1.yaml`, 'utf8');
const pgm = gzipSync(readFileSync(`${REPO}/dashboard_ros/maps/map1.pgm`)).toString('base64');
const upload = (name: string, mapYaml: string, tag: string) =>
  call('/api/maps', {
    cookie: op,
    method: 'POST',
    body: {
      name,
      yaml: mapYaml,
      pgmGzipBase64: pgm,
      features: {
        locationTags: [{ id: 1, name: tag, x: 0, y: 0, theta: 0 }],
        missions: [{ missionId: 7, name: `${tag} run`, locationTagId: [1] }],
      },
    },
  });
const a = await upload('Merge check A', yaml, 'West dock');
const b = await upload(
  'Merge check B',
  yaml.replace(/origin: \[-7\.5,/, 'origin: [-2.5,'),
  'East dock'
);
check(
  'two maps to merge, the second 5 m east',
  a.status === 201 && b.status === 201,
  JSON.stringify([a.json, b.json])
);

const merger = await browserSession(state.acmeOp);
const { page } = merger;
const clickText = (selector: string, text: string) =>
  merger.evaluate<string>(
    `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.textContent.trim().startsWith(${JSON.stringify(text)})); if (!el) return 'missing'; el.click(); return 'ok'; })()`
  );
const meta = () =>
  merger.evaluate<string>(
    `[...document.querySelectorAll('span')].map(s => s.textContent).find(t => t.startsWith('Result')) ?? ''`
  );
const widthOf = async () => Number((await meta()).match(/Result (\d+) ×/)?.[1] ?? 0);

await merger.visit('/maps');
await merger.evaluate(`document.querySelector('summary[aria-label="More map actions"]').click()`);
await clickText('[role="menuitem"]', 'Merge maps');
await poll(
  async () => (await merger.evaluate<string>('location.pathname')) === '/maps/merge',
  5000
);
check(
  'Merge maps opens from the Maps page',
  (await merger.evaluate<string>('location.pathname')) === '/maps/merge'
);

for (const name of ['Merge check A', 'Merge check B']) {
  await merger.evaluate(
    `[...document.querySelectorAll('summary')].find(s => s.textContent.includes('Add map')).click()`
  );
  await sleep(200);
  await clickText('[role="menuitem"]', name);
  await poll(
    async () => (await merger.evaluate<string>('document.body.innerText')).includes(name),
    10_000
  );
  await sleep(500);
}
// A map saved by mapping tools joins as a layer too, straight from its files.
await merger.chooseFiles('input[aria-label="Map files"]', [
  `${REPO}/dashboard_ros/maps/map1.pgm`,
  `${REPO}/dashboard_ros/maps/map1.yaml`,
]);
await poll(
  async () =>
    /map1\s*Uploaded file/.test(
      await merger.evaluate<string>(`document.querySelector('ul')?.innerText ?? ''`)
    ),
  10_000
);
check(
  'local .pgm and .yaml files join as a layer',
  /map1\s*Uploaded file/.test(
    await merger.evaluate<string>(`document.querySelector('ul')?.innerText ?? ''`)
  )
);
await merger.evaluate(`document.querySelector('button[aria-label="Remove map1"]').click()`);
await merger.evaluate(
  `[...document.querySelectorAll('ul button')].find(b => b.textContent.startsWith('Merge check B')).click()`
);
await sleep(200);
const rows = await merger.evaluate<string>(`document.querySelector('ul')?.innerText ?? ''`);
check(
  'the first map is the reference, the second on top',
  /Merge check B[\s\S]*on top[\s\S]*Merge check A[\s\S]*Reference/.test(rows),
  rows
);
check('side by side, the result is 100 px wider', (await widthOf()) === 421, await meta());

// Two pairs: a feature on B, then the same feature on A, which sits 100 px to its left.
const box = await merger.evaluate<{ x: number; y: number; width: number; height: number }>(
  `(() => { const r = document.querySelector('section[aria-label="Merge canvas"]').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`
);
const scale = Math.min(box.width / 421, box.height / 434) * 0.85;
const screen = (ux: number, uy: number) => ({
  x: box.x + (box.width - 421 * scale) / 2 + ux * scale,
  y: box.y + (box.height - 434 * scale) / 2 + uy * scale,
});
const click = async ({ x, y }: { x: number; y: number }) => {
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await page.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await page.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
  await sleep(250);
};
await merger.evaluate(`document.querySelector('[aria-label="Line up by two points (A)"]').click()`);
await sleep(200);
for (const point of [screen(250, 100), screen(150, 100), screen(350, 300), screen(250, 300)])
  await click(point);
const strip = await merger.evaluate<string>(
  `document.querySelector('fieldset[aria-label="Line up by two points"]')?.textContent ?? ''`
);
check(
  'both pairs agree to a few centimetres',
  /Pair A · 0\.0\d m.*Pair B · 0\.0\d m/.test(strip),
  strip
);
await merger.screenshot('merge-pairs');
await clickText('button', 'Line up');
await sleep(300);
const lined = await widthOf();
check('lined up, the maps overlap again', lined >= 321 && lined <= 322, await meta());

const press = async (key: string, times: number) => {
  for (let i = 0; i < times; i += 1) {
    await merger.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '${key}' }))`);
  }
  await sleep(200);
};
await press('ArrowRight', 10);
const nudged = await widthOf();
check(
  'arrow keys nudge the top map 5 cm a press',
  nudged >= lined + 9 && nudged <= lined + 11,
  `${lined} → ${nudged} px`
);
await press('ArrowLeft', 10);
await merger.screenshot('merge-lined-up');
const readout = await merger.evaluate<string>(
  `[...document.querySelectorAll('div')].map(d => d.textContent).find(t => /^Merge check B · x/.test(t)) ?? ''`
);
check(
  'the readout gives the moving map’s place and turn',
  /^Merge check B · x −?\d+\.\d{2} m · y −?\d+\.\d{2} m · −?\d+\.\d°$/.test(readout),
  readout
);

await clickText('button', 'Merge into new map');
await sleep(300);
await merger.evaluate(
  `(() => { const input = document.querySelector('input[aria-label="New map name"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(input, 'Merge check result'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`
);
await merger.evaluate(`document.querySelector('[role="dialog"] button[type="submit"]').click()`);
await poll(async () => (await merger.evaluate<string>('location.pathname')) === '/maps', 20_000);
check(
  'merging goes back to Maps',
  (await merger.evaluate<string>('location.pathname')) === '/maps'
);
await merger.close();

const result = (await listMaps()).find(map => map.name === 'Merge check result');
const detail = result && (await call(`/api/maps/${result.id}`, { cookie: op })).json?.data;
check(
  'the new map is the size of one, since they overlap',
  Boolean(result) && (result?.pixelWidth ?? 0) <= 322,
  JSON.stringify(result)
);
const tags = detail?.features?.locationTags ?? [];
const missions = detail?.features?.missions ?? [];
check(
  'it carries both maps’ tags, renumbered',
  tags.map((tag: { name: string }) => tag.name).join(',') === 'West dock,East dock' &&
    tags.map((tag: { id: unknown }) => String(tag.id)).join(',') === '1,2',
  JSON.stringify(tags)
);
check(
  'and both missions, each still going to its own tag',
  missions.length === 2 &&
    missions.every(
      (mission: { name: string; steps?: unknown[] }, index: number) =>
        String(mission.steps?.[0]) === String(index + 1)
    ),
  JSON.stringify(missions)
);
check(
  'the east tag moved with its map: lining up took it 5 m west',
  Math.abs((tags[1]?.x ?? 99) - ((tags[0]?.x ?? 0) - 5)) < 0.15 &&
    Math.abs((tags[1]?.y ?? 99) - (tags[0]?.y ?? 0)) < 0.15,
  JSON.stringify(tags.map((tag: { x: number; y: number }) => [tag.x, tag.y]))
);

for (const map of (await listMaps()).filter(map => map.name.startsWith('Merge check'))) {
  await call(`/api/maps/${map.id}`, { cookie: state.acme.cookie, method: 'DELETE' });
}
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
