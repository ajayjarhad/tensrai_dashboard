// Map management end to end: upload, assign, edit, sync (zones and the keepout mask reach the
// robot), an edit surviving an import, a robot-side conflict and its resolution, unassign and delete,
// a robot that can't receive maps yet, and the permission and organization rules on the way.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { call, check, ctl, finish, note, REPO, section, state, waitFor } from './e2e-lib';

const { acme, acmeOp, beta } = state;
// By name: earlier suites move and re-create robots, so the ids saved at setup can be stale.
const acmeRobots: { id: string; name: string }[] =
  (await call('/api/robots', { cookie: acmeOp.cookie })).json?.data ?? [];
const idOf = (name: string) => acmeRobots.find(robot => robot.name === name)?.id ?? '';
const a1 = idOf('Forklift A1');
const a2 = idOf('Forklift A2');

type RobotState = { robotId: string; state: string; error?: string };
type MapRow = {
  id: string;
  name: string;
  filename: string;
  revision: string;
  robots: RobotState[];
};
type RobotMap = {
  name: string;
  metadata_json: any;
  map_yaml_content: string;
  keepout: { lethal: number; noEffect: number; yaml: string } | null;
};

const maps = async (cookie: string): Promise<MapRow[]> =>
  (await call('/api/maps', { cookie })).json?.data ?? [];
const mapRow = async (id: string) => (await maps(acmeOp.cookie)).find(map => map.id === id);
const stateOn = async (mapId: string, robotId: string) =>
  (await mapRow(mapId))?.robots.find(robot => robot.robotId === robotId);
const waitForState = (mapId: string, robotId: string, wanted: string, ms = 30000) =>
  waitFor(async () => {
    const current = await stateOn(mapId, robotId);
    return current?.state === wanted && current;
  }, ms);
const robotHas = async (robot: 'a1' | 'a2', stem: string): Promise<RobotMap | undefined> =>
  (JSON.parse(await ctl(robot, '/maps')) as RobotMap[]).find(map => map.name === stem);
const detail = async (id: string) =>
  (await call(`/api/maps/${id}`, { cookie: acmeOp.cookie })).json?.data;
const stemOf = (filename: string) => filename.replace(/\.yaml$/, '');

const yaml = readFileSync(`${REPO}/dashboard_ros/maps/map1.yaml`, 'utf8');
const pgm = readFileSync(`${REPO}/dashboard_ros/maps/map1.pgm`);
const features = {
  locationTags: [
    { id: 1, name: 'E2E dock', x: 0, y: 0, theta: 0, type: 'home' },
    { id: 2, name: 'E2E bay', x: 1, y: 1, theta: 0 },
  ],
  missions: [{ missionId: 901, name: 'E2E run', locationTagId: [1, 2] }],
};

// A failed earlier run can leave its map behind, assigned; clear it so the upload isn't a duplicate.
for (const leftover of (await maps(acmeOp.cookie)).filter(map => map.name.startsWith('E2E'))) {
  for (const robot of leftover.robots) {
    await call(`/api/maps/${leftover.id}/robots/${robot.robotId}`, {
      cookie: acmeOp.cookie,
      method: 'DELETE',
    });
  }
  await waitFor(async () => (await mapRow(leftover.id))?.robots.length === 0, 30000);
  await call(`/api/maps/${leftover.id}`, { cookie: acme.cookie, method: 'DELETE' });
}
await ctl('a1', '/map-reset');
await ctl('a2', '/map-reset');

section('upload');
const uploaded = await call('/api/maps', {
  cookie: acmeOp.cookie,
  method: 'POST',
  body: { name: 'E2E floor', yaml, pgmGzipBase64: gzipSync(pgm).toString('base64'), features },
});
check('a member can upload a map', uploaded.status === 201, [uploaded.status, uploaded.json]);
const mapId: string = uploaded.json?.data?.id;
const filename: string = uploaded.json?.data?.filename;
check('it gets an org-unique map<N> filename', /^map\d+\.yaml$/.test(filename ?? ''), filename);
const again = await call('/api/maps', {
  cookie: acmeOp.cookie,
  method: 'POST',
  body: { name: 'E2E copy', yaml, pgmGzipBase64: gzipSync(pgm).toString('base64'), features },
});
check(
  'the same map again is refused as a duplicate',
  again.json?.code === 'MAP_DUPLICATE',
  again.json
);
const foreign = await call(`/api/maps/${mapId}`, { cookie: beta.cookie });
check("another organization can't see it", foreign.status === 404, foreign.status);

section('assign');
const assign = await call(`/api/maps/${mapId}/robots/${a1}`, {
  cookie: acmeOp.cookie,
  method: 'PUT',
});
check('assigning starts in the background', assign.status === 202, [assign.status, assign.json]);
const synced = await waitForState(mapId, a1, 'synced');
check('the robot reports it holds the map', synced, await stateOn(mapId, a1));
const onRobot = await robotHas('a1', stemOf(filename));
check(
  'the robot has the files under the map’s filename',
  onRobot,
  JSON.parse(await ctl('a1', '/maps')).map((m: RobotMap) => m.name)
);
check(
  'the robot got metadata v2 with its mission',
  onRobot?.metadata_json?.missions?.[0]?.missionId === 901,
  onRobot?.metadata_json
);
check(
  'a keepout mask came with it, with no effect yet',
  onRobot?.keepout?.lethal === 0 && (onRobot?.keepout?.noEffect ?? 0) > 0,
  onRobot?.keepout
);
check(
  'the yaml points at the robot’s own image name',
  onRobot?.map_yaml_content.includes(`image: ${stemOf(filename)}.pgm`),
  onRobot?.map_yaml_content
);

section('edit a zone, then sync');
const before = await detail(mapId);
const withZone = {
  ...features,
  zones: [
    {
      id: 'z1',
      type: 'no_go',
      name: 'E2E no-go',
      polygon: [
        [2, 2],
        [3, 2],
        [3, 3],
        [2, 3],
      ],
    },
    {
      id: 'z2',
      type: 'pick',
      name: 'E2E pallets',
      polygon: [
        [-2, -2],
        [-1, -2],
        [-1, -1],
      ],
      params: { slots: '4' },
    },
  ],
};
const edit = await call(`/api/maps/${mapId}`, {
  cookie: acmeOp.cookie,
  method: 'PATCH',
  body: { baseRevision: before.revision, features: withZone },
});
check(
  'the edit saves with a new revision',
  edit.status === 200 && edit.json?.data?.revision !== before.revision,
  edit.json
);
const stale = await call(`/api/maps/${mapId}`, {
  cookie: acmeOp.cookie,
  method: 'PATCH',
  body: { baseRevision: before.revision, features },
});
check('a save on the old revision is refused', stale.json?.code === 'MAP_CHANGED', stale.json);
check(
  'the robot now needs a sync',
  (await stateOn(mapId, a1))?.state === 'needs_sync',
  await stateOn(mapId, a1)
);
const push = await call(`/api/maps/${mapId}/push`, {
  cookie: acmeOp.cookie,
  method: 'POST',
  body: {},
});
check('sync starts for the robot', push.status === 202 && push.json?.data?.[0]?.started, push.json);
check(
  'the robot is up to date again',
  await waitForState(mapId, a1, 'synced'),
  await stateOn(mapId, a1)
);
const zoned = await robotHas('a1', stemOf(filename));
check(
  'the robot has both zones',
  zoned?.metadata_json?.zones?.length === 2,
  zoned?.metadata_json?.zones
);
check('the no-go zone is lethal in the mask', (zoned?.keepout?.lethal ?? 0) > 0, zoned?.keepout);
note(`mask: ${zoned?.keepout?.lethal} lethal cells, ${zoned?.keepout?.noEffect} untouched`);

section("sync a robot's maps from the Robots page");
const beforeRobotSync = await detail(mapId);
await call(`/api/maps/${mapId}`, {
  cookie: acmeOp.cookie,
  method: 'PATCH',
  body: {
    baseRevision: beforeRobotSync.revision,
    features: {
      ...withZone,
      zones: withZone.zones.map(zone =>
        zone.id === 'z1' ? { ...zone, name: 'E2E no-go west' } : zone
      ),
    },
  },
});
const robotSync = await call(`/api/robots/${a1}/maps/push`, {
  cookie: acmeOp.cookie,
  method: 'POST',
  body: {},
});
check(
  'a robot behind on a map syncs it in one job',
  robotSync.status === 202 && robotSync.json?.data?.mapIds?.includes(mapId),
  robotSync.json
);
check('and is up to date after', await waitForState(mapId, a1, 'synced'), await stateOn(mapId, a1));
const nothingToSync = await call(`/api/robots/${a1}/maps/push`, {
  cookie: acmeOp.cookie,
  method: 'POST',
  body: {},
});
check(
  'a robot with nothing to sync is told so',
  nothingToSync.status === 200 && nothingToSync.json?.data === null,
  nothingToSync.json
);

section('an edit made here survives an import');
const second = await detail(mapId);
const renamed = {
  ...withZone,
  locationTags: withZone.locationTags.map(tag =>
    tag.id === 2 ? { ...tag, name: 'E2E bay renamed' } : tag
  ),
};
await call(`/api/maps/${mapId}`, {
  cookie: acmeOp.cookie,
  method: 'PATCH',
  body: { baseRevision: second.revision, features: renamed },
});
await call(`/api/robots/${a1}/map-sync`, { cookie: acmeOp.cookie, method: 'POST' });
await waitFor(async () => {
  const s = (await call(`/api/robots/${a1}/map-sync`, { cookie: acmeOp.cookie })).json?.data;
  return ['complete', 'failed', 'skipped', 'idle'].includes(s?.phase);
}, 20000);
const afterImport = await detail(mapId);
check(
  'the import kept the dashboard edit',
  afterImport.features.locationTags.some((tag: any) => tag.name === 'E2E bay renamed'),
  afterImport.features.locationTags
);
check(
  'and the robot still just needs a sync',
  (await stateOn(mapId, a1))?.state === 'needs_sync',
  await stateOn(mapId, a1)
);

section('a change on the robot too is a conflict, and resolves');
const robotSide = { ...(await robotHas('a1', stemOf(filename)))?.metadata_json };
robotSide.locationTags = robotSide.locationTags.map((tag: any) =>
  tag.id === 1 ? { ...tag, x: 0.5 } : tag
);
await ctl('a1', `/map-edit?stem=${stemOf(filename)}`, JSON.stringify(robotSide));
await call(`/api/robots/${a1}/map-sync`, { cookie: acmeOp.cookie, method: 'POST' });
check(
  'the import flags a conflict',
  await waitForState(mapId, a1, 'conflict', 20000),
  await stateOn(mapId, a1)
);
const blocked = await call(`/api/maps/${mapId}/push`, {
  cookie: acmeOp.cookie,
  method: 'POST',
  body: {},
});
check('a plain sync does not overwrite the robot’s change', blocked.status === 202, blocked.json);
check(
  'so the conflict stays',
  await waitForState(mapId, a1, 'conflict', 20000),
  await stateOn(mapId, a1)
);
const resolve = await call(`/api/maps/${mapId}/robots/${a1}/resolve`, {
  cookie: acmeOp.cookie,
  method: 'POST',
  body: { keep: 'dashboard' },
});
check('resolving sends ours', resolve.status === 202, resolve.json);
check(
  'and the robot is up to date',
  await waitForState(mapId, a1, 'synced'),
  await stateOn(mapId, a1)
);
const resolved = await robotHas('a1', stemOf(filename));
check(
  'the robot has the dashboard copy',
  resolved?.metadata_json?.locationTags?.some((tag: any) => tag.name === 'E2E bay renamed'),
  resolved?.metadata_json?.locationTags
);

section("a robot that can't receive maps yet");
await ctl('a2', '/map-put?mode=unsupported');
const assignA2 = await call(`/api/maps/${mapId}/robots/${a2}`, {
  cookie: acmeOp.cookie,
  method: 'PUT',
});
check('assigning to it starts', assignA2.status === 202, assignA2.json);
check(
  'the map list says the robot can’t receive maps yet',
  await waitForState(mapId, a2, 'unsupported'),
  await stateOn(mapId, a2)
);
check('nothing is stored for it', !(await robotHas('a2', stemOf(filename))));
await ctl('a2', '/map-reset');
const dismiss = await call(`/api/maps/${mapId}/robots/${a2}`, {
  cookie: acmeOp.cookie,
  method: 'DELETE',
});
check(
  'dismissing the refused assignment clears it',
  dismiss.status === 200 && !(await stateOn(mapId, a2)),
  [dismiss.status, await stateOn(mapId, a2)]
);

section('unassign, then delete');
const memberDelete = await call(`/api/maps/${mapId}`, { cookie: acmeOp.cookie, method: 'DELETE' });
check('a member may not delete maps', memberDelete.status === 403, memberDelete.status);
const assigned = await call(`/api/maps/${mapId}`, { cookie: acme.cookie, method: 'DELETE' });
check('an assigned map cannot be deleted', assigned.json?.code === 'MAP_ASSIGNED', assigned.json);
const unassign = await call(`/api/maps/${mapId}/robots/${a1}`, {
  cookie: acmeOp.cookie,
  method: 'DELETE',
});
check('unassigning starts', unassign.status === 202, unassign.json);
const gone = await waitFor(async () => (await mapRow(mapId))?.robots.length === 0, 30000);
check('the link is gone', gone, await mapRow(mapId));
check('the robot deleted its files', !(await robotHas('a1', stemOf(filename))));
const deleted = await call(`/api/maps/${mapId}`, { cookie: acme.cookie, method: 'DELETE' });
check('an admin deletes the unassigned map', deleted.status === 200, deleted.json);
check('it is gone from the list', !(await mapRow(mapId)));

await ctl('a1', '/map-reset');
finish();
