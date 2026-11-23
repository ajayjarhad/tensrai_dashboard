// Browser check for the map editor against a running stack (tools/e2e/run.sh --keep): draws a
// stroke, undoes and redoes it, saves, crops, checks the YAML dialog refuses a bad origin, and that
// leaving with unsaved edits asks first. Screenshots land in tools/e2e/.out/editor-*.png.
//   bun tools/e2e/check-editor.ts
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { browserSession, uniqueYaml } from './browser.ts';
import { call, REPO, sleep, state } from './e2e-lib.ts';

const NAME = 'Editor check floor';
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

type MapInfo = {
  id: string;
  name: string;
  revision: string;
  editedAt: string | null;
  pixelWidth: number;
  metadata: { origin: number[] };
};
const op = state.acmeOp.cookie;
const mapInfo = async (id: string): Promise<MapInfo> =>
  (await call(`/api/maps/${id}`, { cookie: op })).json?.data;
const zeroCells = async (info: MapInfo) => {
  const res = await fetch(
    new URL(
      `/api/maps/${info.id}/image?rev=${info.revision}`,
      process.env.E2E_WEB ?? 'http://127.0.0.1:18080'
    ),
    {
      headers: { cookie: op },
    }
  );
  const bytes = new Uint8Array(await res.arrayBuffer());
  const header = new TextDecoder()
    .decode(bytes.slice(0, 40))
    .match(/^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/);
  return bytes.slice(header?.[0].length ?? 0).filter(value => value === 0).length;
};

for (const leftover of ((await call('/api/maps', { cookie: op })).json?.data ?? []).filter(
  (map: MapInfo) => map.name === NAME
)) {
  await call(`/api/maps/${leftover.id}`, { cookie: state.acme.cookie, method: 'DELETE' });
}
const created = await call('/api/maps', {
  cookie: op,
  method: 'POST',
  body: {
    name: NAME,
    yaml: readFileSync(uniqueYaml('check-editor'), 'utf8'),
    pgmGzipBase64: gzipSync(readFileSync(`${REPO}/dashboard_ros/maps/map1.pgm`)).toString('base64'),
  },
});
const mapId: string = created.json?.data?.id;
check('a map to edit', created.status === 201, JSON.stringify(created.json));
const original = await mapInfo(mapId);
const zerosBefore = await zeroCells(original);

const editor = await browserSession(state.acmeOp);
const { page } = editor;
const key = (key: string, mods: { ctrlKey?: boolean; shiftKey?: boolean } = {}) =>
  editor.evaluate(
    `window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, ctrlKey: ${Boolean(mods.ctrlKey)}, shiftKey: ${Boolean(mods.shiftKey)} }))`
  );
const status = () =>
  editor.evaluate<string>(
    `[...document.querySelectorAll('span')].map(s => s.textContent.trim()).find(t => t === 'Saved' || t === 'Unsaved changes') ?? ''`
  );
const clickButton = (text: string) =>
  editor.evaluate(
    `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)})?.click()`
  );
const canvasBox = () =>
  editor.evaluate<{ x: number; y: number; width: number; height: number }>(
    `(() => { const r = document.querySelector('section[aria-label="Map canvas"]').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`
  );
const drag = async (from: [number, number], to: [number, number]) => {
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from[0], y: from[1] });
  await page.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: from[0],
    y: from[1],
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  for (let step = 1; step <= 12; step += 1) {
    const x = from[0] + ((to[0] - from[0]) * step) / 12;
    const y = from[1] + ((to[1] - from[1]) * step) / 12;
    await page.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
      button: 'left',
      buttons: 1,
    });
  }
  await page.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: to[0],
    y: to[1],
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
  await sleep(300);
};

await editor.visit(`/maps/${mapId}/edit`);
await poll(async () => (await status()) === 'Saved');
check('the editor opens the map, saved', (await status()) === 'Saved', await status());
const box = await canvasBox();
const mid: [number, number] = [box.x + box.width / 2, box.y + box.height / 2];

await key('b');
const pressed = await editor.evaluate<string | null>(
  `document.querySelector('[aria-label="Draw (B)"]')?.getAttribute('aria-pressed') ?? null`
);
check(
  'B picks Draw, with its size option',
  pressed === 'true' &&
    (await editor.evaluate<boolean>(
      `Boolean(document.querySelector('fieldset[aria-label="Brush size"]'))`
    )),
  String(pressed)
);
await key(']');
await key(']');
await drag([mid[0] - 120, mid[1] - 40], [mid[0] + 120, mid[1] + 40]);
check('a stroke leaves unsaved changes', (await status()) === 'Unsaved changes', await status());
await editor.screenshot('editor-stroke');

await key('z', { ctrlKey: true });
await sleep(200);
check('undo takes it back to saved', (await status()) === 'Saved', await status());
await key('z', { ctrlKey: true, shiftKey: true });
await sleep(200);
check('redo brings the stroke back', (await status()) === 'Unsaved changes', await status());

await clickButton('Save');
await poll(async () => (await status()) === 'Saved');
const saved = await mapInfo(mapId);
check(
  'save stores a new revision',
  saved.revision !== original.revision && Boolean(saved.editedAt),
  saved.revision
);
const zerosAfter = await zeroCells(saved);
check(
  'the saved image has the stroke',
  zerosAfter > zerosBefore,
  `${zerosBefore} → ${zerosAfter} occupied cells`
);

await key('Escape');
await editor.evaluate(`document.querySelector('summary[aria-label="More"]').click()`);
await editor.evaluate(
  `[...document.querySelectorAll('[role="menuitem"]')].find(i => i.textContent.trim() === 'Crop map').click()`
);
await sleep(200);
await drag([mid[0] - 150, mid[1] - 100], [mid[0] + 150, mid[1] + 100]);
await editor.screenshot('editor-crop');
await clickButton('Crop');
await sleep(300);
await clickButton('Save');
await poll(async () => (await status()) === 'Saved');
const cropped = await mapInfo(mapId);
check(
  'a crop saves a smaller map',
  cropped.pixelWidth < original.pixelWidth,
  `${original.pixelWidth} → ${cropped.pixelWidth} px wide`
);
check(
  'and moves the origin so the world stays put',
  (cropped.metadata.origin[0] ?? 0) > (original.metadata.origin[0] ?? 0),
  `${original.metadata.origin} → ${cropped.metadata.origin}`
);

await editor.evaluate(`document.querySelector('summary[aria-label="More"]').click()`);
await editor.evaluate(
  `[...document.querySelectorAll('[role="menuitem"]')].find(i => i.textContent.trim() === 'Map YAML').click()`
);
await sleep(400);
await editor.evaluate(
  `(() => { const area = document.querySelector('textarea[aria-label="Map YAML"]'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(area, area.value.replace(/origin: \\[([^,]+), ([^,]+), [^\\]]+\\]/, 'origin: [$1, $2, 0.5]')); area.dispatchEvent(new Event('input', { bubbles: true })); })()`
);
await clickButton('Apply');
await sleep(300);
const yamlError = await editor.evaluate<string>(
  `document.querySelector('[role="dialog"] [role="alert"]')?.textContent ?? ''`
);
check('the YAML dialog refuses a rotated origin', /yaw/.test(yamlError), yamlError);
await editor.screenshot('editor-yaml');
await clickButton('Cancel');
await sleep(300);

const click = async (x: number, y: number) => {
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
  await sleep(150);
};
const notice = () =>
  editor.evaluate<string>(
    `[...document.querySelectorAll('output')].map(o => o.textContent.trim()).join(' | ')`
  );
const card = () =>
  editor.evaluate<string | null>(
    `document.querySelector('section[aria-label^="Selected"]')?.getAttribute('aria-label') ?? null`
  );

// A no-go zone, closed on its first corner.
await key('z');
const corners: [number, number][] = [
  [mid[0] - 40, mid[1] - 40],
  [mid[0] + 40, mid[1] - 40],
  [mid[0] + 40, mid[1] + 40],
  [mid[0] - 40, mid[1] + 40],
];
for (const [x, y] of corners) await click(x, y);
await click(corners[0][0], corners[0][1]);
check(
  'a zone closes on its first corner and is selected',
  /Selected zone: No-go zone/.test((await card()) ?? ''),
  String(await card())
);

// A tag inside it can't be saved; Show and the message say why.
await key('t');
await click(mid[0], mid[1]);
check(
  'a tag lands and is selected',
  /Selected tag: Tag/.test((await card()) ?? ''),
  String(await card())
);
check(
  'a tag inside a no-go zone blocks saving',
  /Can't save yet\..*inside the no-go zone/.test(await notice()),
  await notice()
);
check(
  'Save is off while it does',
  await editor.evaluate<boolean>(
    `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save')?.disabled ?? false`
  )
);
await editor.screenshot('editor-problem');
await key('Escape');
await key('Delete');
check(
  'deleting the tag clears the problem',
  !/Can't save yet/.test(await notice()),
  await notice()
);

// A tag outside, facing north (dragged upwards), then the zone becomes a pick zone with a parameter.
await key('t');
await drag([mid[0] + 120, mid[1]], [mid[0] + 120, mid[1] - 60]);
await key('p');
await click(mid[0] - 100, mid[1] + 80);
await click(mid[0], mid[1] + 110);
await click(mid[0] + 100, mid[1] + 80);
await key('Enter');
check(
  'a path finishes on Enter',
  /Selected path: Preferred path 1/.test((await card()) ?? ''),
  String(await card())
);
await key('Escape');
await click(mid[0], mid[1] - 39);
check(
  'clicking a zone with no tool selects it',
  /Selected zone/.test((await card()) ?? ''),
  String(await card())
);
const cardBox = await editor.evaluate<{ left: number; top: number } | null>(
  `(() => { const r = document.querySelector('section[aria-label^="Selected"]')?.getBoundingClientRect(); return r ? { left: r.left, top: r.top } : null; })()`
);
check(
  'its card sits beside the zone, not in a corner',
  Boolean(cardBox) &&
    Math.abs((cardBox?.left ?? 0) - (mid[0] + 40)) < 120 &&
    Math.abs((cardBox?.top ?? 0) - (mid[1] - 40)) < 160,
  JSON.stringify(cardBox)
);
await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mid[0] - 10, y: mid[1] - 10 });
await sleep(200);
check(
  'the readout names the zone under the pointer',
  (await editor.evaluate<string>(`document.body.innerText`)).includes('· in No-go zone 1'),
  await editor.evaluate<string>(
    `[...document.querySelectorAll('div')].map(d => d.textContent).find(t => t.startsWith('x ')) ?? ''`
  )
);
await editor.evaluate(
  `document.querySelector('button[aria-label="Hide zones, paths and tags"]').click()`
);
await sleep(200);
check('Layers hides the shapes and their card', !(await card()), String(await card()));
await editor.evaluate(
  `document.querySelector('button[aria-label="Show zones, paths and tags"]').click()`
);
await sleep(200);
await click(mid[0], mid[1] - 39);
await editor.evaluate(
  `(() => { const select = document.querySelector('select[aria-label="Zone type"]'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(select, 'pick'); select.dispatchEvent(new Event('change', { bubbles: true })); })()`
);
await sleep(200);
check(
  'its type changes to pick',
  /Pick|pick/.test(
    await editor.evaluate<string>(
      `document.querySelector('select[aria-label="Zone type"]')?.value ?? ''`
    )
  )
);
await editor.screenshot('editor-features');
await clickButton('Save');
await poll(async () => (await status()) === 'Saved');
const withFeatures = (await call(`/api/maps/${mapId}`, { cookie: op })).json?.data;
const zones = withFeatures?.features?.zones ?? [];
const tags = withFeatures?.features?.locationTags ?? [];
const paths = withFeatures?.features?.paths ?? [];
check(
  'and the preferred path, three points long',
  paths.length === 1 && paths[0].type === 'preferred' && paths[0].points.length === 3,
  JSON.stringify(paths)
);
check(
  'the saved map has the pick zone',
  zones.length === 1 && zones[0].type === 'pick' && zones[0].polygon.length === 4,
  JSON.stringify(zones)
);
check(
  'and the tag, facing north',
  tags.length === 1 &&
    Math.abs(tags[0].theta - Math.PI / 2) < 0.05 &&
    /^\d+$/.test(String(tags[0].id)),
  JSON.stringify(tags)
);

// Someone else saves meanwhile: this save is refused, and Reload brings their version in.
const elsewhere = (await call(`/api/maps/${mapId}`, { cookie: op })).json?.data;
await call(`/api/maps/${mapId}`, {
  cookie: op,
  method: 'PATCH',
  body: {
    baseRevision: elsewhere.revision,
    features: {
      ...elsewhere.features,
      zones: elsewhere.features.zones.map((zone: object) => ({
        ...zone,
        name: 'Renamed elsewhere',
      })),
    },
  },
});
await key('b');
await drag([mid[0] - 60, mid[1] + 60], [mid[0] + 60, mid[1] + 60]);
await clickButton('Save');
await poll(async () => /Someone saved this map/.test(await notice()), 8000);
check(
  'a save on top of someone else’s is refused',
  /Someone saved this map/.test(await notice()),
  await notice()
);
await editor.screenshot('editor-conflict');
await clickButton('Reload');
await poll(async () => (await status()) === 'Saved', 10_000);
check(
  'Reload brings their version in, with nothing unsaved',
  (await status()) === 'Saved' && !/Someone saved/.test(await notice()),
  await status()
);

await key('b');
await drag([mid[0] - 60, mid[1]], [mid[0] + 60, mid[1]]);
check('another stroke is unsaved', (await status()) === 'Unsaved changes', await status());
const dialog = page.next('Page.javascriptDialogOpening');
await editor.evaluate(
  `setTimeout(() => document.querySelector('a[aria-label="Back to Maps"]').click(), 0)`
);
const opened = await Promise.race([dialog, sleep(5000).then(() => null)]);
check('leaving with unsaved edits asks first', Boolean(opened), 'no dialog');
if (opened) await page.send('Page.handleJavaScriptDialog', { accept: false });
await sleep(500);
check(
  'staying keeps the editor open',
  (await editor.evaluate<string>('location.pathname')).endsWith('/edit')
);
await key('z', { ctrlKey: true });
await editor.evaluate(`document.querySelector('a[aria-label="Back to Maps"]').click()`);
await poll(async () => (await editor.evaluate<string>('location.pathname')) === '/maps', 5000);
check(
  'with nothing unsaved, Back goes straight to Maps',
  (await editor.evaluate<string>('location.pathname')) === '/maps'
);
await editor.close();

await call(`/api/maps/${mapId}`, { cookie: state.acme.cookie, method: 'DELETE' });
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
