// Browser check for the Maps page against a running stack (tools/e2e/run.sh --keep): a member
// uploads a map through the dialog, assigns it to a robot and watches its chip turn up to date; an
// admin takes it off the robot and deletes it. Screenshots land in tools/e2e/.out/maps-*.png.
//   bun tools/e2e/check-maps.ts
import { browserSession, uniqueYaml } from './browser.ts';
import { call, ctl, REPO, sleep, state } from './e2e-lib.ts';

const NAME = 'Browser check floor';
const ROBOT = 'Forklift A1';
let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `   ${detail}`}`);
};
const poll = async (test: () => Promise<boolean>, ms = 40_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(500))
    if (await test()) return true;
  return false;
};

type MapRow = {
  id: string;
  name: string;
  robots: { robotId: string; name: string; filename: string | null }[];
};
const apiMaps = async (): Promise<MapRow[]> =>
  (await call('/api/maps', { cookie: state.acmeOp.cookie })).json?.data ?? [];

// A failed earlier run can leave the map behind.
for (const leftover of (await apiMaps()).filter(map => map.name === NAME)) {
  for (const robot of leftover.robots) {
    await call(`/api/maps/${leftover.id}/robots/${robot.robotId}`, {
      cookie: state.acmeOp.cookie,
      method: 'DELETE',
    });
  }
  await poll(async () => !(await apiMaps()).find(map => map.id === leftover.id)?.robots.length);
  await call(`/api/maps/${leftover.id}`, { cookie: state.acme.cookie, method: 'DELETE' });
}

const ROW = `[...document.querySelectorAll('tbody tr')].find(tr => tr.cells[0]?.textContent.includes(${JSON.stringify(NAME)}))`;
const clickIn = (scope: string, selector: string, text: string) =>
  `(() => { const el = [...(${scope})?.querySelectorAll(${JSON.stringify(selector)}) ?? []].find(e => e.textContent.trim() === ${JSON.stringify(text)}); if (!el) return 'missing'; el.click(); return 'ok'; })()`;
const DIALOG = `document.querySelector('[role="dialog"]')`;
const chipOf = (robot: string) =>
  `[...(${ROW})?.cells[2].querySelectorAll('span[title]') ?? []].find(chip => chip.textContent.startsWith(${JSON.stringify(robot)}))`;
const typeInto = (selector: string, value: string) =>
  `(() => { const input = document.querySelector(${JSON.stringify(selector)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); return input.value; })()`;
const toggleRobot = (robot: string) =>
  `(() => { const label = [...${DIALOG}.querySelectorAll('label')].find(l => l.textContent.trim() === ${JSON.stringify(robot)}); document.getElementById(label.htmlFor).click(); return 'ok'; })()`;

// A member uploads, assigns and syncs.
{
  const member = await browserSession(state.acmeOp);
  await member.visit('/maps');
  const page = await member.evaluate<{ title: string; tab: string | null; upload: boolean }>(`({
    title: document.querySelector('h1')?.textContent ?? '',
    tab: [...document.querySelectorAll('nav[aria-label="Main"] a[aria-current="page"]')].map(a => a.textContent.trim()).find(Boolean) ?? null,
    upload: [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Upload map'),
  })`);
  check(
    'the Maps page opens with its tab current',
    page.title === 'Maps' && page.tab === 'Maps',
    JSON.stringify(page)
  );
  check('a member can upload', page.upload);

  await member.evaluate(clickIn('document', 'button', 'Upload map'));
  await sleep(500);
  await member.chooseFiles('#upload-files', [
    `${REPO}/dashboard_ros/maps/map1.pgm`,
    uniqueYaml('check-maps'),
  ]);
  await sleep(300);
  await member.evaluate(typeInto('#upload-name', NAME));
  await member.screenshot('maps-upload-dialog');
  await member.evaluate(`${DIALOG}.querySelector('button[type="submit"]').click()`);
  const listed = await poll(() => member.evaluate<boolean>(`Boolean(${ROW})`), 20_000);
  check('the uploaded map shows in the list', listed);
  check(
    'it is on no robot yet',
    await member.evaluate<boolean>(
      `(${ROW})?.cells[2].textContent.includes('Not on any robot') ?? false`
    )
  );

  await member.evaluate(`(${ROW}).querySelector('summary').click()`);
  const memberMenu = await member.evaluate<string[]>(
    `[...(${ROW}).querySelectorAll('[role="menuitem"]')].map(item => item.textContent.trim())`
  );
  check(
    'a member has no Delete',
    !memberMenu.some(item => item.startsWith('Delete')),
    memberMenu.join(', ')
  );
  await member.evaluate(`(${ROW}).querySelector('summary').click()`);

  await member.evaluate(clickIn(ROW, 'button', 'Assign'));
  await sleep(500);
  await member.evaluate(toggleRobot(ROBOT));
  const footer = await member.evaluate<string>(`${DIALOG}.textContent ?? ''`);
  check(
    'the Assign footer says what Apply will do',
    footer.includes(`Adds ${ROBOT}. Nothing is removed.`),
    footer
  );
  await member.screenshot('maps-assign-dialog');
  await member.evaluate(clickIn(DIALOG, 'button', 'Apply'));
  const synced = await poll(() =>
    member.evaluate<boolean>(
      `Boolean((${chipOf(ROBOT)})?.querySelector('[aria-label="up to date"]'))`
    )
  );
  check(
    `the ${ROBOT} chip turns up to date`,
    synced,
    await member.evaluate<string>(`(${chipOf(ROBOT)})?.textContent ?? 'no chip'`)
  );
  const link = (await apiMaps()).find(map => map.name === NAME)?.robots.find(r => r.name === ROBOT);
  const stem = link?.filename?.replace(/\.yaml$/, '') ?? '';
  const onRobot = JSON.parse(await ctl('a1', '/maps')) as { name: string }[];
  check(
    `the robot holds it as ${stem || 'its file'}`,
    Boolean(stem) && onRobot.some(map => map.name === stem),
    onRobot.map(map => map.name).join(', ')
  );
  await member.screenshot('maps-member-synced');

  // Both sides change: Resolve shows what each copy has, and taking the robot's settles it.
  const robotId = (
    (await call('/api/robots', { cookie: state.acmeOp.cookie })).json?.data ?? []
  ).find((robot: { name: string }) => robot.name === ROBOT)?.id;
  const mapId = (await apiMaps()).find(map => map.name === NAME)?.id;
  const ours = (await call(`/api/maps/${mapId}`, { cookie: state.acmeOp.cookie })).json?.data;
  await call(`/api/maps/${mapId}`, {
    cookie: state.acmeOp.cookie,
    method: 'PATCH',
    body: {
      baseRevision: ours.revision,
      features: {
        ...ours.features,
        locationTags: [{ id: 90, name: 'Dock 90', x: 0, y: 0, theta: 0 }],
      },
    },
  });
  const theirs = (
    JSON.parse(await ctl('a1', '/maps')) as {
      name: string;
      metadata_json: Record<string, unknown>;
    }[]
  ).find(map => map.name === stem);
  await ctl(
    'a1',
    `/map-edit?stem=${stem}`,
    JSON.stringify({
      ...theirs?.metadata_json,
      missions: [{ missionId: 77, name: 'Night run', locationTagId: [] }],
    })
  );
  await call(`/api/robots/${robotId}/map-sync`, { cookie: state.acmeOp.cookie, method: 'POST' });
  await poll(async () =>
    Boolean(
      (await apiMaps())
        .find(map => map.id === mapId)
        ?.robots.some(r => r.name === ROBOT && (r as { state?: string }).state === 'conflict')
    )
  );
  await member.visit('/maps');
  const conflicted = await poll(() =>
    member.evaluate<boolean>(`(${chipOf(ROBOT)})?.textContent.includes('Resolve') ?? false`)
  );
  check(
    'a change on both sides shows Resolve',
    conflicted,
    await member.evaluate<string>(`(${chipOf(ROBOT)})?.textContent ?? ''`)
  );
  await member.evaluate(
    `[...(${chipOf(ROBOT)}).querySelectorAll('button')].find(b => b.textContent === 'Resolve').click()`
  );
  await poll(
    () =>
      member.evaluate<boolean>(`(${DIALOG})?.textContent.includes('only on the robot') ?? false`),
    10_000
  );
  const conflictText = await member.evaluate<string>(`${DIALOG}?.textContent ?? ''`);
  check(
    'the Conflict dialog says what each copy has',
    conflictText.includes('1 location tag only here: Dock 90') &&
      conflictText.includes('1 mission only on the robot: 77 Night run'),
    conflictText
  );
  await member.screenshot('maps-conflict-dialog');
  await member.evaluate(
    `[...${DIALOG}.querySelectorAll('input[type="radio"]')].find(r => r.value === 'robot').click()`
  );
  await member.evaluate(clickIn(DIALOG, 'button', `Take ${ROBOT}'s version`));
  const settled = await poll(() =>
    member.evaluate<boolean>(
      `Boolean((${chipOf(ROBOT)})?.querySelector('[aria-label="up to date"]'))`
    )
  );
  check(
    "taking the robot's version settles it",
    settled,
    await member.evaluate<string>(`(${chipOf(ROBOT)})?.textContent ?? ''`)
  );

  // On a phone the table becomes cards, without editing.
  await member.page.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await member.visit('/maps');
  const phone = await member.evaluate<{
    cards: number;
    table: boolean;
    note: boolean;
    edit: boolean;
  }>(`({
    cards: document.querySelectorAll('article').length,
    table: document.querySelector('table')?.offsetParent !== null && Boolean(document.querySelector('table')),
    note: document.body.innerText.includes('Editing and merging maps need a larger screen'),
    edit: [...document.querySelectorAll('article a')].some(a => a.textContent.includes('Edit')),
  })`);
  check(
    'on a phone the maps are cards, not a table',
    phone.cards > 0 && !phone.table && phone.note && !phone.edit,
    JSON.stringify(phone)
  );
  await member.screenshot('maps-phone');
  await member.page.send('Emulation.clearDeviceMetricsOverride');
  await member.close();
}

// An admin takes it off the robot, then deletes it.
{
  const admin = await browserSession(state.acme);
  await admin.visit('/maps');
  await admin.evaluate(clickIn(ROW, 'button', 'Assign'));
  await sleep(500);
  await admin.evaluate(toggleRobot(ROBOT));
  await admin.evaluate(clickIn(DIALOG, 'button', 'Apply'));
  const removed = await poll(() =>
    admin.evaluate<boolean>(`(${ROW})?.cells[2].textContent.includes('Not on any robot') ?? false`)
  );
  check('removing it from the robot empties its robots', removed);

  await admin.evaluate(`window.confirm = () => true; (${ROW}).querySelector('summary').click()`);
  await admin.evaluate(clickIn(ROW, '[role="menuitem"]', 'Delete'));
  const gone = await poll(() => admin.evaluate<boolean>(`!${ROW}`), 15_000);
  check('an admin deletes it', gone);
  await admin.screenshot('maps-admin-after-delete');
  await admin.close();
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
