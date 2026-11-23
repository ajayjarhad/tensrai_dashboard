import { afterEach, beforeEach, expect, test } from 'bun:test';
import { gunzipSync, gzipSync } from 'node:zlib';
import { asUser, createTestApp, ORG_A, ORG_B } from '../testing/authStub.js';

process.env['MAP_SYNC_CONNECT_TIMEOUT_MS'] = '300';
const { default: mapManagementRoutes } = await import('./mapManagement.js');
const { default: mapRoutes } = await import('./maps.js');
const { default: mapAssignmentRoutes } = await import('./mapAssignments.js');
const { resetRobotMapJobs } = await import('../services/robotMapJobs.js');
const { hydrateMissionStateFromPersistedRun } = await import('../services/missionStatus.js');

// In-memory rows behind a Prisma-shaped delegate, matching the where clauses these routes use.
type Row = Record<string, any>;
const meets = (value: unknown, condition: Row) => {
  if ('not' in condition) return value !== condition['not'];
  if ('in' in condition) return (condition['in'] as unknown[]).includes(value);
  if ('isSet' in condition) return condition['isSet'] ? value !== undefined : value === undefined;
  return true;
};
const matches = (row: Row, where: Row = {}): boolean =>
  Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') return (condition as Row[]).some(sub => matches(row, sub));
    if (key === 'robotId_mapId') {
      return row['robotId'] === condition.robotId && row['mapId'] === condition.mapId;
    }
    const isFilter = condition && typeof condition === 'object' && !(condition instanceof Date);
    return isFilter ? meets(row[key], condition) : row[key] === condition;
  });

const collection = (rows: Row[], prefix: string) => {
  let seq = 0;
  return {
    rows,
    findMany: async ({ where }: Row = {}) => rows.filter(row => matches(row, where)),
    findFirst: async ({ where }: Row = {}) => rows.find(row => matches(row, where)) ?? null,
    findUnique: async ({ where }: Row) => rows.find(row => matches(row, where)) ?? null,
    count: async ({ where }: Row = {}) => rows.filter(row => matches(row, where)).length,
    create: async ({ data }: Row) => {
      seq += 1;
      const row = { id: `${prefix}-new-${seq}`, ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: Row) => {
      const row = rows.find(candidate => matches(candidate, where));
      if (!row) throw Object.assign(new Error('not found'), { code: 'P2025' });
      return Object.assign(row, data);
    },
    updateMany: async ({ where, data }: Row) => {
      const hit = rows.filter(row => matches(row, where));
      for (const row of hit) Object.assign(row, data);
      return { count: hit.length };
    },
    delete: async ({ where }: Row) => {
      const index = rows.findIndex(row => matches(row, where));
      return rows.splice(index, 1)[0];
    },
  };
};

const pgm = (fill = 254) => Buffer.concat([Buffer.from('P5\n4 3\n255\n'), Buffer.alloc(12, fill)]);
const upload = (name: string, fill = 254) => ({
  name,
  yaml: 'image: map.pgm\nresolution: 0.05\norigin: [-1, -2, 0]\n',
  pgmGzipBase64: gzipSync(pgm(fill)).toString('base64'),
  features: { locationTags: [{ id: 1, name: 'Dock', x: 0, y: 0 }] },
});

const seed = () => ({
  map: collection(
    [
      {
        id: 'map-a',
        orgId: ORG_A,
        name: 'Floor A',
        filename: 'map1.yaml',
        image: pgm(),
        metadata: { image: 'map1.pgm', resolution: 0.05, origin: [0, 0, 0] },
        features: { locationTags: [], missions: [{ id: '3', missionId: 3, steps: [] }] },
        revision: 'rev-a',
        editedAt: null,
      },
      {
        id: 'map-b',
        orgId: ORG_B,
        name: 'Floor B',
        filename: 'map1.yaml',
        image: pgm(),
        metadata: {},
        features: {},
        revision: 'rev-b',
      },
    ],
    'map'
  ),
  robotMap: collection(
    [{ orgId: ORG_A, robotId: 'robot-a', mapId: 'map-a', isActive: true, filename: 'map1.yaml' }],
    'link'
  ),
  robot: collection(
    [
      {
        id: 'robot-a',
        orgId: ORG_A,
        name: 'Forklift',
        ipAddress: '127.0.0.1',
        mappingBridgePort: 9,
      },
      {
        id: 'robot-idle',
        orgId: ORG_A,
        name: 'Spare',
        ipAddress: '127.0.0.1',
        mappingBridgePort: 9,
      },
      {
        id: 'robot-no-bridge',
        orgId: ORG_A,
        name: 'Old',
        ipAddress: null,
        mappingBridgePort: null,
      },
    ],
    'robot'
  ),
  robotAddress: { findFirst: async () => ({ id: 'approved' }) },
  auditLog: { create: async () => ({}) },
});

let db = seed();
const app = createTestApp({ scopeDb: true });
app.decorate('prisma', new Proxy({}, { get: (_target, key) => (db as Row)[key as string] }));
app.decorate('audit', async () => {});
await app.register(mapRoutes, { prefix: '/api' });
await app.register(mapManagementRoutes, { prefix: '/api' });
await app.register(mapAssignmentRoutes, { prefix: '/api' });
await app.ready();

beforeEach(() => {
  db = seed();
});
afterEach(async () => {
  // Jobs against the unreachable robot end within the shortened connect timeout.
  await new Promise(resolve => setTimeout(resolve, 350));
  resetRobotMapJobs();
});

const send = (method: string, url: string, who: Parameters<typeof asUser>[0], payload?: unknown) =>
  app.inject({ method, url, headers: asUser(who), ...(payload === undefined ? {} : { payload }) });

test('a member uploads a map; it gets the next free filename and a revision', async () => {
  const res = await send('POST', '/api/maps', 'user', upload('Dock'));
  expect(res.statusCode).toBe(201);
  expect(res.json().data).toMatchObject({ name: 'Dock', filename: 'map2.yaml' });
  expect(res.json().data.revision).toHaveLength(64);
});

test('an uploaded image is stored gzipped and sent gzipped to browsers, unpacked to others', async () => {
  const id = (await send('POST', '/api/maps', 'user', upload('Dock'))).json().data.id;
  const image = (mapId: string, gzip: boolean) =>
    app.inject({
      method: 'GET',
      url: `/api/maps/${mapId}/image`,
      headers: { ...asUser('user'), ...(gzip ? { 'accept-encoding': 'gzip, br' } : {}) },
    });
  const zipped = await image(id, true);
  expect(zipped.headers['content-encoding']).toBe('gzip');
  expect(gunzipSync(zipped.rawPayload)).toEqual(pgm());
  const plain = await image(id, false);
  expect(plain.headers['content-encoding']).toBeUndefined();
  expect(plain.rawPayload).toEqual(pgm());
  // Records from before gzip storage hold the raw PGM and go out as they are.
  const legacy = await image('map-a', true);
  expect(legacy.headers['content-encoding']).toBeUndefined();
  expect(legacy.rawPayload).toEqual(pgm());
});

test('an identical upload is refused, naming the map it matches', async () => {
  await send('POST', '/api/maps', 'user', upload('Dock'));
  const again = await send('POST', '/api/maps', 'user', upload('Dock copy'));
  expect([again.statusCode, again.json().code]).toEqual([409, 'MAP_DUPLICATE']);
});

test('a bad upload says what is wrong', async () => {
  const yaw = await send('POST', '/api/maps', 'user', {
    ...upload('Tilted'),
    yaml: 'resolution: 0.05\norigin: [0, 0, 0.3]\n',
  });
  expect([yaw.statusCode, yaw.json().code]).toEqual([400, 'INVALID_YAML']);
  const noImage = await send('POST', '/api/maps', 'user', {
    ...upload('Broken'),
    pgmGzipBase64: 'AAAA',
  });
  expect([noImage.statusCode, noImage.json().code]).toEqual([400, 'INVALID_IMAGE']);
});

test('members edit and sync; only admins delete', async () => {
  db.robotMap.rows.splice(0);
  const asMember = await send('DELETE', '/api/maps/map-a', 'user');
  expect([asMember.statusCode, asMember.json().code]).toEqual([403, 'INSUFFICIENT_PERMISSIONS']);
  const asAdmin = await send('DELETE', '/api/maps/map-a', 'admin');
  expect(asAdmin.statusCode).toBe(200);
  expect(db.map.rows.map(map => map['id'])).toEqual(['map-b']);
});

test('a map a robot still holds cannot be deleted', async () => {
  const res = await send('DELETE', '/api/maps/map-a', 'admin');
  expect([res.statusCode, res.json().code]).toEqual([409, 'MAP_ASSIGNED']);
});

test("every map route treats another organization's map as missing", async () => {
  for (const [method, url, payload] of [
    ['GET', '/api/maps/map-b', undefined],
    ['PATCH', '/api/maps/map-b', { name: 'Taken' }],
    ['DELETE', '/api/maps/map-b', undefined],
    ['PUT', '/api/maps/map-b/robots/robot-a', undefined],
    ['DELETE', '/api/maps/map-b/robots/robot-a', undefined],
    ['POST', '/api/maps/map-b/push', {}],
    ['POST', '/api/maps/map-b/robots/robot-a/resolve', { keep: 'robot' }],
    ['GET', '/api/maps/map-b/assignment-preview', undefined],
    ['GET', '/api/maps/map-b/robots/robot-a/conflict', undefined],
  ] as const) {
    const res = await send(method, url, 'admin', payload);
    expect([method, url, res.statusCode]).toEqual([method, url, 404]);
  }
  expect(db.map.rows.find(map => map['id'] === 'map-b')?.['name']).toBe('Floor B');
});

test('a save on top of a newer revision is refused, and a rename needs no revision', async () => {
  const stale = await send('PATCH', '/api/maps/map-a', 'user', {
    baseRevision: 'rev-old',
    features: { locationTags: [] },
  });
  expect([stale.statusCode, stale.json().code]).toEqual([409, 'MAP_CHANGED']);
  const rename = await send('PATCH', '/api/maps/map-a', 'user', { name: 'Floor A west' });
  expect(rename.statusCode).toBe(200);
  expect(db.map.rows[0]?.['name']).toBe('Floor A west');
});

test('the first edit marks robots linked before revisions as holding the old version', async () => {
  const res = await send('PATCH', '/api/maps/map-a', 'user', {
    baseRevision: 'rev-a',
    features: { locationTags: [{ id: 4, name: 'Bay 4', x: 1, y: 1 }], missions: [] },
  });
  expect(res.statusCode).toBe(200);
  expect(db.map.rows[0]).toMatchObject({ revision: res.json().data.revision });
  expect(db.map.rows[0]?.['editedAt']).toBeInstanceOf(Date);
  expect(db.robotMap.rows[0]?.['pushedRevision']).toBe('rev-a');
});

test('assigning refuses a robot without a mapping bridge, or one running a mission', async () => {
  const noBridge = await send('PUT', '/api/maps/map-a/robots/robot-no-bridge', 'user');
  expect([noBridge.statusCode, noBridge.json().code]).toEqual([400, 'NO_MAPPING_BRIDGE']);

  hydrateMissionStateFromPersistedRun('robot-idle', { phase: 'running', missionId: '9' });
  const busy = await send('PUT', '/api/maps/map-a/robots/robot-idle', 'user');
  expect([busy.statusCode, busy.json().code]).toEqual([409, 'MISSION_RUNNING']);
  hydrateMissionStateFromPersistedRun('robot-idle', { phase: 'completed', missionId: '9' });
});

test('a mission id the robot already has in another map blocks the assignment', async () => {
  db.map.rows.push({
    id: 'map-c',
    orgId: ORG_A,
    name: 'Floor C',
    filename: 'map3.yaml',
    revision: 'rev-c',
    features: { missions: [{ missionId: 3, locationTagId: [] }] },
  });
  const res = await send('PUT', '/api/maps/map-c/robots/robot-a', 'user');
  expect([res.statusCode, res.json().code]).toEqual([409, 'MISSION_ID_CONFLICT']);
});

test('one map operation per robot: a second is refused while the first runs', async () => {
  const first = await send('PUT', '/api/maps/map-a/robots/robot-idle', 'user');
  expect(first.statusCode).toBe(202);
  const second = await send('POST', '/api/maps/map-a/push', 'user', {});
  expect(second.statusCode).toBe(202);
  const map = await send('PUT', '/api/maps/map-a/robots/robot-idle', 'user');
  expect([map.statusCode, map.json().code]).toEqual([409, 'ROBOT_BUSY']);
});

test("the robot's active map cannot be taken off it", async () => {
  const res = await send('DELETE', '/api/maps/map-a/robots/robot-a', 'user');
  expect([res.statusCode, res.json().code]).toEqual([409, 'MAP_ACTIVE']);
});

test('the map list carries each robot with its sync state', async () => {
  Object.assign(db.robotMap.rows[0] ?? {}, { pushedRevision: 'rev-a' });
  const res = await send('GET', '/api/maps', 'user');
  expect(res.json().data[0].robots).toEqual([
    expect.objectContaining({
      robotId: 'robot-a',
      name: 'Forklift',
      state: 'synced',
      isActive: true,
    }),
  ]);
  Object.assign(db.map.rows[0] ?? {}, { revision: 'rev-a2' });
  const after = await send('GET', '/api/maps', 'user');
  expect(after.json().data[0].robots[0].state).toBe('needs_sync');
});

test('an assignment the robot never took shows on the map, and can be dismissed', async () => {
  const res = await send('PUT', '/api/maps/map-a/robots/robot-idle', 'user');
  expect(res.statusCode).toBe(202);
  const pending = (await send('GET', '/api/maps', 'user')).json().data[0].robots;
  expect(pending).toContainEqual(
    expect.objectContaining({ robotId: 'robot-idle', state: 'syncing', assigning: true })
  );
  // The robot is unreachable, so the job fails within the shortened connect timeout.
  await new Promise(resolve => setTimeout(resolve, 400));
  const failed = (await send('GET', '/api/maps', 'user')).json().data[0].robots;
  expect(failed).toContainEqual(
    expect.objectContaining({ robotId: 'robot-idle', state: 'failed' })
  );

  const dismissed = await send('DELETE', '/api/maps/map-a/robots/robot-idle', 'user');
  expect(dismissed.statusCode).toBe(200);
  const after = (await send('GET', '/api/maps', 'user')).json().data[0].robots;
  expect(after.map((robot: { robotId: string }) => robot.robotId)).toEqual(['robot-a']);
});

test('the assign preview names the file each robot would get and the missions it would repeat', async () => {
  db.map.rows.push({
    id: 'map-c',
    orgId: ORG_A,
    name: 'Floor C',
    filename: 'map1.yaml',
    revision: 'rev-c',
    features: { missions: [{ missionId: 3, locationTagId: [] }] },
  });
  const res = await send('GET', '/api/maps/map-c/assignment-preview', 'user');
  const byRobot = Object.fromEntries(
    res.json().data.map((row: { robotId: string }) => [row.robotId, row])
  );
  expect(byRobot['robot-a']).toMatchObject({
    holds: false,
    stem: 'map2',
    stemTaken: 'map1',
    missionClashes: [3],
    clashMapName: 'Floor A',
  });
  expect(byRobot['robot-idle']).toMatchObject({ stem: 'map1', missionClashes: [] });
  expect(byRobot['robot-no-bridge']).toMatchObject({ hasMappingBridge: false });
});

test('a conflict read shows both copies, and there is none without a conflict', async () => {
  const none = await send('GET', '/api/maps/map-a/robots/robot-a/conflict', 'user');
  expect(none.statusCode).toBe(404);
  Object.assign(db.robotMap.rows[0] ?? {}, {
    conflictRevision: 'rev-robot',
    conflictCopy: { features: { missions: [{ missionId: 5 }] }, imageSha256: 'abc', at: 'then' },
  });
  const res = await send('GET', '/api/maps/map-a/robots/robot-a/conflict', 'user');
  expect(res.json().data.robot).toMatchObject({ imageSha256: 'abc', at: 'then' });
  expect(res.json().data.robot.features.missions[0].missionId).toBe(5);
  expect(res.json().data.ours.features.missions[0].missionId).toBe(3);
});
