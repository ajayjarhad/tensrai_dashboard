// Maps: robot files -> backend -> DB -> what the UI loads, per org and per robot.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  backendLogs,
  call,
  check,
  ctl,
  finish,
  mongoJson,
  note,
  openSocket,
  REPO,
  section,
  sleep,
  state,
  stats,
  waitFor,
} from './e2e-lib';

const { acme, acmeOp, beta, a1, a2, b1, acmeOrg, betaOrg } = state;

const sync = (robotId: string, cookie: string) =>
  call(`/api/robots/${robotId}/map-sync`, { cookie, method: 'POST' });
const robot = async (id: string, cookie: string) =>
  (await call(`/api/robots/${id}`, { cookie })).json?.data;
const robotMaps = async (id: string, cookie: string) =>
  (await call(`/api/robots/${id}/maps`, { cookie })).json?.data ?? [];
const maps = async (cookie: string) => (await call('/api/maps', { cookie })).json?.data ?? [];
const syncStatus = async (id: string, cookie: string) =>
  (await call(`/api/robots/${id}/map-sync`, { cookie })).json?.data;
const syncEnded = (id: string, cookie: string, ms = 12000) =>
  waitFor(async () => {
    const s = await syncStatus(id, cookie);
    return ['complete', 'failed', 'skipped', 'idle'].includes(s?.phase) && s;
  }, ms);
const waitForMaps = (id: string, cookie: string, count: number, ms = 25000) =>
  waitFor(async () => {
    const rows = await robotMaps(id, cookie);
    return rows.length >= count && rows;
  }, ms);
const pgmHash = (name: string) =>
  createHash('sha256')
    .update(readFileSync(`${REPO}/dashboard_ros/maps/${name}`))
    .digest('hex');

section('legacy sync on a real robot’s files (map + map1)');
const res = await sync(a1, acmeOp.cookie);
check('a plain member can sync their org’s robot', res.status < 300, [res.status, res.json]);
const a1Maps = await waitForMaps(a1, acmeOp.cookie, 2);
check('both maps arrive', a1Maps, await robotMaps(a1, acmeOp.cookie));
note(`robot maps: ${JSON.stringify(await robotMaps(a1, acmeOp.cookie)).slice(0, 400)}`);
await sleep(1000);
const list = await maps(acmeOp.cookie);
note(
  `Acme maps: ${list.map((m: any) => `${m.name}[${m.pixelWidth}x${m.pixelHeight} webp=${m.displayWebpSizeBytes} err=${m.displayGenerationError}]`).join(', ')}`
);
check('Acme has two maps', list.length === 2, list);
for (const m of list) {
  check(`${m.name}: dimensions parsed`, m.pixelWidth > 0 && m.pixelHeight > 0, m);
  check(
    `${m.name}: display assets generated`,
    m.displayWebpSizeBytes > 0 || m.displayPngSizeBytes > 0,
    m
  );
  check(`${m.name}: no display error`, !m.displayGenerationError, m.displayGenerationError);
}
const mapRow = list.find((m: any) => m.name === 'map' || m.name === 'map.yaml') ?? list[0];
const detail = (await call(`/api/maps/${mapRow.id}`, { cookie: acmeOp.cookie })).json?.data;
check(
  'metadata comes from map.yaml',
  detail?.metadata?.resolution === 0.05 && Array.isArray(detail?.metadata?.origin),
  detail?.metadata
);
note(
  `features keys: ${Object.keys(detail?.features ?? {})}; missions: ${JSON.stringify(detail?.features?.missions)?.slice(0, 300)}`
);
check(
  'location tags come from metadata.json',
  detail?.features?.stations?.length === 4 || detail?.features?.locationTags?.length === 4,
  Object.keys(detail?.features ?? {})
);
check(
  'missions come from metadata.json',
  detail?.features?.missions?.some((m: any) => String(m.id ?? m.missionId) === '1'),
  detail?.features?.missions
);
const image = await call(`/api/maps/${mapRow.id}/image`, { cookie: acmeOp.cookie, raw: true });
check(
  'the raw map is byte-identical to the robot’s',
  createHash('sha256').update(image.bytes).digest('hex') === pgmHash('map.pgm'),
  image.status
);
check(
  'the image is not publicly cacheable',
  !/public/.test(image.headers.get('cache-control') ?? ''),
  image.headers.get('cache-control')
);
const webp = await call(`/api/maps/${mapRow.id}/display/webp`, {
  cookie: acmeOp.cookie,
  raw: true,
});
check(
  'display webp serves',
  webp.status === 200 && webp.headers.get('content-type') === 'image/webp' && webp.bytes.length > 0,
  webp.status
);
const preview = await call(`/api/maps/${mapRow.id}/preview/webp`, {
  cookie: acmeOp.cookie,
  raw: true,
});
check('preview webp serves', preview.status === 200, preview.status);
const row = await robot(a1, acmeOp.cookie);
check(
  'the robot has an active map',
  row?.mapId || (await robotMaps(a1, acmeOp.cookie)).some((m: any) => m.isActive),
  row
);
note(
  `robot.mapId=${row?.mapId}; default map row: ${JSON.stringify((await robotMaps(a1, acmeOp.cookie)).find((m: any) => m.isActive))?.slice(0, 200)}`
);

section('a second robot in the org, same filename, different floor (the overwrite bug)');
const before = await call(`/api/maps/${mapRow.id}/image`, { cookie: acmeOp.cookie, raw: true });
await sync(a2, acme.cookie);
await waitForMaps(a2, acme.cookie, 2);
await sleep(1000);
const after = await call(`/api/maps/${mapRow.id}/image`, { cookie: acmeOp.cookie, raw: true });
check(
  'A1’s floor was not overwritten',
  Buffer.compare(Buffer.from(before.bytes), Buffer.from(after.bytes)) === 0
);
const acmeList = await maps(acme.cookie);
note(
  `Acme maps now: ${acmeList.map((m: any) => `${m.name}:${m.contentHash?.slice(0, 8)}`).join(', ')}`
);
const a1Ids = (await robotMaps(a1, acme.cookie)).map((m: any) => m.id ?? m.mapId);
const a2Ids = (await robotMaps(a2, acme.cookie)).map((m: any) => m.id ?? m.mapId);
note(`a1 ids ${a1Ids}; a2 ids ${a2Ids}`);
const a2Active = (await robotMaps(a2, acme.cookie)).find((m: any) => m.isActive);
const a2ActiveId = a2Active?.id ?? a2Active?.mapId;
check('A2’s active map is its own floor', a2ActiveId && a2ActiveId !== mapRow.id, a2Active);
if (a2ActiveId) {
  const a2Image = await call(`/api/maps/${a2ActiveId}/image`, { cookie: acme.cookie, raw: true });
  const a2Hash = createHash('sha256').update(a2Image.bytes).digest('hex');
  check('A2’s default floor is the robot’s default file', a2Hash === pgmHash('map1.pgm'), a2Hash);
}

section('another org with byte-identical files gets its own copy');
await sync(b1, beta.cookie);
await waitForMaps(b1, beta.cookie, 2);
await sleep(800);
const betaList = await maps(beta.cookie);
check('Beta has its own two maps', betaList.length === 2, betaList);
check(
  'none of them are Acme’s records',
  betaList.every((m: any) => !acmeList.some((a: any) => a.id === m.id)),
  betaList
);
check('Acme’s maps are not listed for Beta', !betaList.some((m: any) => m.id === mapRow.id));
for (const url of [
  `/api/maps/${mapRow.id}`,
  `/api/maps/${mapRow.id}/image`,
  `/api/maps/${mapRow.id}/display/webp`,
  `/api/maps/${mapRow.id}/preview/webp`,
]) {
  const r = await call(url, { cookie: beta.cookie, raw: url !== `/api/maps/${mapRow.id}` });
  check(`Beta GET ${url.replace(mapRow.id, ':acmeMap')} is 404`, r.status === 404, r.status);
}
const stolen = await call(`/api/robots/${b1}/active-map`, {
  cookie: beta.cookie,
  method: 'POST',
  body: { mapId: mapRow.id },
});
check('Beta cannot point its robot at Acme’s map', stolen.status >= 400 && stolen.status < 500, [
  stolen.status,
  stolen.json,
]);
const noCookie = await call(`/api/maps/${mapRow.id}/image`, { raw: true });
check('no session, no map', noCookie.status === 401, noCookie.status);

section('re-sync is idempotent');
const idsBefore = (await maps(acme.cookie))
  .map((m: any) => m.id)
  .sort()
  .join();
await sync(a1, acme.cookie);
await sleep(3000);
check(
  're-syncing the same files creates nothing',
  (await maps(acme.cookie))
    .map((m: any) => m.id)
    .sort()
    .join() === idsBefore,
  await maps(acme.cookie)
);
const counts = mongoJson(`db.RobotMap.countDocuments({robotId:ObjectId('${a1}')})`);
check('no duplicate robot-map links', counts === 2, counts);
check(
  'RobotMap rows are stamped with the org',
  mongoJson(`db.RobotMap.find({robotId:ObjectId('${a1}')}).toArray()`).every(
    (r: any) => r.orgId?.$oid === acmeOrg
  )
);
check(
  'Beta’s RobotMap rows are Beta’s',
  mongoJson(`db.RobotMap.find({robotId:ObjectId('${b1}')}).toArray()`).every(
    (r: any) => r.orgId?.$oid === betaOrg
  )
);

section('active map');
const a1Rows = await robotMaps(a1, acmeOp.cookie);
const other = a1Rows.find((m: any) => !m.isActive);
const otherId = other?.id ?? other?.mapId;
const setActive = await call(`/api/robots/${a1}/active-map`, {
  cookie: acmeOp.cookie,
  method: 'POST',
  body: { mapId: otherId },
});
check('a member can switch the active map', setActive.status === 200, [
  setActive.status,
  setActive.json,
]);
check(
  'the switch sticks',
  (await robotMaps(a1, acmeOp.cookie)).find((m: any) => m.isActive)?.mapId === otherId ||
    (await robotMaps(a1, acmeOp.cookie)).find((m: any) => m.isActive)?.id === otherId,
  await robotMaps(a1, acmeOp.cookie)
);
await ctl('a1', '/status');
await sleep(500);
const afterTick = (await robotMaps(a1, acmeOp.cookie)).find((m: any) => m.isActive);
check(
  'a pinned map survives the robot’s status update',
  (afterTick?.mapId ?? afterTick?.id) === otherId,
  afterTick
);
const auto = await call(`/api/robots/${a1}/active-map/auto`, {
  cookie: acmeOp.cookie,
  method: 'POST',
  body: {},
});
check('switching back to auto works', auto.status === 200, [auto.status, auto.json]);

section('missions know their names once the map is synced');
const m = await openSocket(`/ws/robots/${a1}/mapping/e2e`, acmeOp.cookie);
m.send({ type: 'command', event: 'SHOW_UP', commandId: 'named-1', payload: { missionId: 1 } });
await m.waitEvent('MISSION_CONTROL_ACK', p => p.requestId === 'named-1');
await sleep(300);
const named = (await call(`/api/robots/${a1}/current-mission`, { cookie: acmeOp.cookie })).json
  ?.data;
note(`preview run: ${JSON.stringify(named).slice(0, 260)}`);
check(
  'the run has the mission’s name',
  named?.missionNameSnapshot === 'Mission Trial',
  named?.missionNameSnapshot
);
m.close();

section('chunked protocol');
const chunkMaps = await robotMaps(a2, acme.cookie);
const allMaps = await maps(acme.cookie);
const storedHashes = Object.fromEntries(
  chunkMaps.map((row: any) => [
    row.name,
    allMaps.find((m: any) => m.id === (row.id ?? row.mapId))?.contentHash,
  ])
);
await ctl('a2', `/map?mode=chunked&hashes=${encodeURIComponent(JSON.stringify(storedHashes))}`);
await ctl('a2', '/reset');
const countBefore = allMaps.length;
await sync(a2, acme.cookie);
await waitFor(
  async () =>
    (await stats('a2')).received.mapping.filter((e: string) => e === 'MAP_SKIP').length >= 2,
  10000
);
const skipSeen = (await stats('a2')).received.mapping;
note(`a2 robot received: ${skipSeen.join(' ')}`);
check(
  'unchanged maps are skipped, not re-sent',
  skipSeen.filter((e: string) => e === 'MAP_SKIP').length === 2 &&
    !skipSeen.includes('MAP_SEND_CHUNKS'),
  skipSeen
);

await ctl('a2', '/map?mode=chunked');
await ctl('a2', '/reset');
await sync(a2, acme.cookie);
await waitFor(
  async () =>
    (await stats('a2')).received.mapping.filter((e: string) => e === 'MAP_TRANSFER_STORED')
      .length >= 2,
  10000
);
note(`a2 robot received: ${(await stats('a2')).received.mapping.join(' ')}`);
check(
  'a robot with no matching hash transfers in chunks and it is stored',
  (await stats('a2')).received.mapping.filter((e: string) => e === 'MAP_TRANSFER_STORED').length ===
    2,
  (await stats('a2')).received.mapping
);
check(
  'no duplicate records from the transfer',
  (await maps(acme.cookie)).length === countBefore,
  (await maps(acme.cookie)).length
);
const a2DefaultId = (await robotMaps(a2, acme.cookie)).find((m: any) => m.isActive)?.id;
const chunked = await call(`/api/maps/${a2DefaultId}/image`, { cookie: acme.cookie, raw: true });
check(
  'the chunked map is byte-identical',
  createHash('sha256').update(chunked.bytes).digest('hex') === pgmHash('map1.pgm')
);

const faultSync = async (fault: string, mode = 'chunked') => {
  await ctl('a2', `/map?mode=${mode}&fault=${fault}`);
  await ctl('a2', '/reset');
  const r = await sync(a2, acme.cookie);
  await sleep(300);
  const ended = await syncEnded(a2, acme.cookie, 15000);
  const seen = (await stats('a2')).received.mapping;
  note(
    `${fault}: POST ${r.status}, ended ${JSON.stringify(ended && { phase: (ended as any).phase, lastError: (ended as any).lastError })}, robot received ${seen.join(' ')}`
  );
  return { ended: ended as any, seen };
};
const sha = await faultSync('sha');
check(
  'a wrong checksum fails the sync',
  sha.ended?.phase === 'failed' && /sha256/.test(sha.ended?.lastError ?? ''),
  sha.ended
);
check('and is not stored', !sha.seen.includes('MAP_TRANSFER_STORED'), sha.seen);
const bomb = await faultSync('bomb');
check(
  'a gzip bomb fails the sync (and a failed sync did not block this one)',
  bomb.seen.includes('GET_MAP_DATA') && bomb.ended?.phase === 'failed',
  bomb
);
check(
  'the backend is still up after the bomb',
  (await call('/api/robots', { cookie: acme.cookie })).status === 200
);
const badGzip = await faultSync('badgzip');
check('corrupt gzip fails the sync', badGzip.ended?.phase === 'failed', badGzip.ended);
check(
  'none of those stored anything',
  (await maps(acme.cookie)).length === countBefore,
  (await maps(acme.cookie)).length
);

section('a robot that sends bad legacy map data');
const noFiles = await faultSync('nofiles', 'legacy');
check(
  '“No map files found” ends the sync with that reason, not a 45s timeout',
  noFiles.ended?.phase === 'failed' && /No map files/.test(noFiles.ended?.lastError ?? ''),
  noFiles.ended
);
const missing = await faultSync('missing', 'legacy');
check('missing contents fail the sync', missing.ended?.phase === 'failed', missing.ended);
const badPgm = await faultSync('badpgm', 'legacy');
note(`not-a-PGM: ${JSON.stringify(badPgm.ended).slice(0, 200)}`);
const a2Active2 = (await robotMaps(a2, acme.cookie)).find((m: any) => m.isActive);
const afterBad = (await call(`/api/maps/${a2Active2?.id}`, { cookie: acme.cookie })).json?.data;
check('unreadable image fails the sync', badPgm.ended?.phase === 'failed', badPgm.ended);
check(
  'and does not replace the floor',
  !afterBad?.displayGenerationError &&
    (await call(`/api/maps/${a2Active2?.id}/image`, { cookie: acme.cookie, raw: true })).bytes
      .length > 1000,
  afterBad?.displayGenerationError
);
await faultSync('none', 'legacy');
for (const fault of ['notbase64', 'badyaml', 'badmeta', 'nullmeta', 'evilname', 'htmlname']) {
  const r = await faultSync(fault, 'legacy');
  check(
    `${fault}: backend stays up and the sync ends`,
    r.ended && (await call('/api/robots', { cookie: acme.cookie })).status === 200,
    r.ended
  );
}
const namesNow = (await maps(acme.cookie)).map((m: any) => m.name);
note(`map names after the attack: ${JSON.stringify(namesNow)}`);
check(
  'a map filename cannot be a path',
  !namesNow.some((n: string) => n.includes('..') || n.includes('/')),
  namesNow
);
const rowsNow = await robotMaps(a2, acme.cookie);
check('robot-map list still loads', Array.isArray(rowsNow), rowsNow);
note(`a2 maps after attacks: ${JSON.stringify(rowsNow.map((r: any) => [r.name, r.isActive]))}`);
const healed = await faultSync('none', 'legacy');
check('the next good sync works', healed.ended?.phase === 'complete', healed.ended);

section('sync that fails at the network');
await ctl('a2', '/refuse?on=1');
await ctl('a2', '/drop?port=8765');
const refused = await sync(a2, acme.cookie);
const refusedEnd = await syncEnded(a2, acme.cookie, 12000);
check(
  'an unreachable robot fails the sync with a reason',
  (refusedEnd as any)?.phase === 'failed' && (refusedEnd as any)?.lastError,
  refusedEnd
);
note(`refused: sync ${refused.status} ${JSON.stringify(refused.json)?.slice(0, 200)}`);
check(
  'an unreachable robot does not break the API',
  (await call('/api/robots', { cookie: acme.cookie })).status === 200
);
await ctl('a2', '/refuse?on=0');

const errors = backendLogs('3m')
  .split('\n')
  .filter(l => /TypeError|ReferenceError|Unhandled|"level":50|"level":"error"/.test(l));
note(
  `backend error lines: ${errors.length}; ${errors
    .slice(0, 4)
    .map(e => e.slice(0, 200))
    .join(' | ')}`
);
finish();
