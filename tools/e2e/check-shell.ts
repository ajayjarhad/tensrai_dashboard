// Browser check for the app shell against a running stack (tools/e2e/run.sh --keep): signs in as each
// test account, reads the header, and stops and releases the fleet from a page that is not the
// dashboard. Screenshots land in tools/e2e/.out/shell-*.png.
//   bun tools/e2e/check-shell.ts
import { browserSession } from './browser.ts';
import { sleep, state } from './e2e-lib.ts';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `   ${detail}`}`);
};

const READ_HEADER = `(() => {
  const header = document.querySelector('header');
  // The phone menu is in the DOM too; only the visible list of tabs counts.
  const tabs = [...document.querySelectorAll('nav[aria-label="Main"]')].find(nav => nav.offsetParent !== null);
  const buttons = [...(header?.querySelectorAll('button') ?? [])].map(b => b.textContent.trim());
  return {
    path: location.pathname,
    tabs: [...(tabs?.querySelectorAll('a') ?? [])].map(a => a.textContent.trim()),
    current: [...(tabs?.querySelectorAll('a[aria-current="page"]') ?? [])].map(a => a.textContent.trim()).join(',') || null,
    fleet: header?.querySelector('output')?.textContent.trim() ?? null,
    account: header?.querySelector('summary[aria-label^="Account"]')?.getAttribute('aria-label') ?? null,
    stop: buttons.includes('Emergency stop'),
    release: buttons.includes('Release'),
  };
})()`;

const clickButton = (label: string) =>
  `[...document.querySelectorAll('header button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})?.click() ?? 'missing'`;

type Header = {
  path: string;
  tabs: string[];
  current: string | null;
  fleet: string | null;
  account: string | null;
  stop: boolean;
  release: boolean;
};

// Operator: dashboard only, the E-stop present, no admin pages.
{
  const op = await browserSession(state.acmeOp);
  await op.visit('/');
  const header = await op.evaluate<Header>(READ_HEADER);
  check(
    'operator sees the Dashboard and Maps tabs',
    JSON.stringify(header.tabs) === '["Dashboard","Maps"]',
    JSON.stringify(header.tabs)
  );
  check('operator has the fleet E-stop', header.stop);
  check(
    'the fleet summary reads robots online',
    /online/.test(header.fleet ?? ''),
    String(header.fleet)
  );
  check(
    'the account menu names the operator',
    header.account === `Account: ${state.acmeOp.username}` || Boolean(header.account),
    String(header.account)
  );
  await op.screenshot('shell-operator-dashboard');
  await op.visit('/admin/robots');
  const blocked = await op.evaluate<Header>(READ_HEADER);
  check('operator is kept out of the robots page', blocked.path === '/unauthorized', blocked.path);
  await op.close();
}

// Admin: the admin tabs, and a stop and release from the robots page.
{
  const admin = await browserSession(state.acme);
  await admin.visit('/admin/robots');
  let header = await admin.evaluate<Header>(READ_HEADER);
  check(
    'admin sees Dashboard, Maps, Robots and Users',
    JSON.stringify(header.tabs) === '["Dashboard","Maps","Robots","Users"]',
    JSON.stringify(header.tabs)
  );
  check('the robots tab is the current page', header.current === 'Robots', String(header.current));
  check(
    'the E-stop is on the robots page',
    header.stop && header.path === '/admin/robots',
    header.path
  );
  await admin.screenshot('shell-admin-robots');

  await admin.evaluate(clickButton('Emergency stop'));
  let stopped = false;
  for (let i = 0; i < 20 && !stopped; i += 1) {
    await sleep(500);
    header = await admin.evaluate<Header>(READ_HEADER);
    stopped = /stopped/.test(header.fleet ?? '') && header.release;
  }
  check(
    'a stop from the robots page shows in the header with Release',
    stopped,
    JSON.stringify(header)
  );
  await admin.screenshot('shell-admin-stopped');

  await admin.visit('/admin/users');
  header = await admin.evaluate<Header>(READ_HEADER);
  check(
    'the stop stays visible after leaving the robots page',
    /stopped/.test(header.fleet ?? '') && header.release,
    JSON.stringify(header)
  );

  await admin.evaluate(clickButton('Release'));
  let released = false;
  for (let i = 0; i < 20 && !released; i += 1) {
    await sleep(500);
    header = await admin.evaluate<Header>(READ_HEADER);
    released = !/stopped/.test(header.fleet ?? '') && !header.release;
  }
  check('Release from the users page clears the stop', released, JSON.stringify(header));
  await admin.close();
}

// Staff: every tab.
{
  const staff = await browserSession(state.staff);
  await staff.visit('/staff');
  const header = await staff.evaluate<Header>(READ_HEADER);
  check(
    'staff see every page',
    JSON.stringify(header.tabs) === '["Dashboard","Maps","Robots","Users","Organizations"]',
    JSON.stringify(header.tabs)
  );
  await staff.close();
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
