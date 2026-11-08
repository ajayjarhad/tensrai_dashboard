import { expect, test } from 'bun:test';
import cors from '@fastify/cors';
import bcrypt from 'bcryptjs';
import { asStaffIn, asUser, createTestApp, fakeRobotModel, ORG_A } from '../testing/authStub.js';

const { default: mapRoutes } = await import('./maps.js');
const { default: missionRunRoutes } = await import('./missionRuns.js');
const { default: robotRoutes } = await import('./robots.js');
const { default: staffRoutes } = await import('./staff.js');
const { default: userRoutes } = await import('./users.js');

// first-time-setup is how a user with a temporary password gets a usable one, so it must
// stay reachable by sessions the guard turns away; it checks the session itself.
const SELF_GUARDED = '/api/auth/first-time-setup';

type RouteInfo = { method: string; url: string };

const userUpdates: any[] = [];

const TEMP_PASSWORD = 'temporary-password';
const pendingSetupRow = async (id: string) => ({
  id,
  role: 'USER',
  displayName: null,
  tempPasswordHash: await bcrypt.hash(TEMP_PASSWORD, 4),
  tempPasswordExpiry: new Date(Date.now() + 60_000),
});

const DATABASE_FAILURE =
  'Invalid `prisma.user.findFirst()` invocation: could not reach mongodb://10.0.0.5:27017';
const failWithDatabaseError = async () => {
  throw new Error(DATABASE_FAILURE);
};

const prisma = {
  robot: {
    ...fakeRobotModel([{ id: 'r1', orgId: ORG_A }]),
    create: async ({ data }: any) => ({ id: 'new-robot', orgId: ORG_A, ...data }),
    groupBy: async () => [],
  },
  map: { findMany: async () => [], findUnique: async () => null },
  user: {
    findMany: async () => [],
    groupBy: async () => [],
    findFirst: async (_args: any): Promise<unknown> => null,
    findUnique: async ({ where }: any): Promise<unknown> => {
      if (where.id.endsWith('reset')) return pendingSetupRow(where.id);
      if (where.id === 'colleague') return { id: 'colleague', role: 'USER', username: 'colleague' };
      if (where.id === 'staff-member') return { id: 'staff-member', role: 'STAFF' };
      return null;
    },
    update: async ({ where, data }: any) => {
      userUpdates.push(data);
      return { id: where.id, ...data };
    },
  },
  auditLog: { create: async () => ({}) },
  organization: { findMany: async () => [] },
  robotAddress: {
    groupBy: async () => [],
    findMany: async () => [],
    upsert: async () => ({ id: 'a1', status: 'PENDING' }),
  },
};

const buildApp = async () => {
  const app = createTestApp();
  const routes: RouteInfo[] = [];
  // Registered first so it sees every route the plugins add; a new unguarded route fails the sweeps below.
  app.addHook('onRoute', (route: { method: string | string[]; url: string }) => {
    if (!route.url.startsWith('/api')) return;
    for (const method of [route.method].flat()) {
      if (method !== 'HEAD') routes.push({ method, url: route.url });
    }
  });
  app.decorate('prisma', prisma);
  await app.register(cors, { origin: true, credentials: true });
  for (const plugin of [robotRoutes, mapRoutes, missionRunRoutes, userRoutes, staffRoutes]) {
    await app.register(plugin, { prefix: '/api' });
  }
  await app.ready();
  return { app, routes };
};

const { app, routes } = await buildApp();

const call = ({ method, url }: RouteInfo, headers: Record<string, string> = {}) =>
  app.inject({
    method,
    url: url.replace(/:\w+/g, 'r1'),
    headers,
    // Valid for first-time-setup's schema so the sweep reaches its own session check.
    ...(['POST', 'PUT', 'PATCH'].includes(method) && {
      payload: { tempPassword: 'x', newPassword: 'xxxxxxxx', confirmPassword: 'x' },
    }),
  });

const guarded = routes.filter(route => route.url !== SELF_GUARDED);

test('registers the routes the sweeps cover', () => {
  expect(routes.length).toBeGreaterThan(15);
  expect(guarded.length).toBe(routes.length - 1);
});

test('every route rejects a request with no session', async () => {
  for (const route of routes) {
    const res = await call(route);
    expect([route.method, route.url, res.statusCode]).toEqual([route.method, route.url, 401]);
  }
});

test('every route rejects a disabled account', async () => {
  for (const route of guarded) {
    const res = await call(route, asUser('disabled'));
    expect([route.method, route.url, res.statusCode]).toEqual([route.method, route.url, 403]);
  }
});

test('every route holds back a user who has not set a password yet', async () => {
  for (const route of guarded) {
    const res = await call(route, asUser('needsReset'));
    expect([route.method, route.url, res.statusCode]).toEqual([route.method, route.url, 428]);
  }
});

test('a regular user can read robots, maps and mission runs', async () => {
  for (const url of [
    '/api/robots',
    '/api/maps',
    '/api/mission-runs',
    '/api/robots/r1/current-mission',
  ]) {
    const res = await call({ method: 'GET', url }, asUser('user'));
    expect([url, res.statusCode]).toEqual([url, 200]);
  }
});

test('user management is admin only', async () => {
  const userRoutesOnly = routes.filter(route => route.url.startsWith('/api/users'));
  expect(userRoutesOnly.length).toBe(6);

  for (const route of userRoutesOnly) {
    const res = await call(route, asUser('user'));
    expect([route.method, route.url, res.statusCode]).toEqual([route.method, route.url, 403]);
  }

  const asAdmin = await call({ method: 'GET', url: '/api/users' }, asUser('admin'));
  expect(asAdmin.statusCode).toBe(200);
});

test('a CORS preflight is answered without a session', async () => {
  const res = await app.inject({
    method: 'OPTIONS',
    url: '/api/robots',
    headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' },
  });
  expect(res.statusCode).toBe(204);
  expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
});

test('a user without an organization is turned away', async () => {
  for (const route of guarded) {
    const res = await call(route, asUser('noOrg'));
    expect([route.method, route.url, res.statusCode]).toEqual([route.method, route.url, 403]);
    expect(res.json().code).toBe('NO_ORGANIZATION');
  }
});

test('every robot route answers 404 for a robot of another organization', async () => {
  const robotIdRoutes = routes.filter(route => route.url.startsWith('/api/robots/:id'));
  expect(robotIdRoutes.length).toBeGreaterThanOrEqual(9);

  for (const route of robotIdRoutes) {
    const foreign = await call(route, asUser('otherOrgAdmin'));
    expect([route.method, route.url, foreign.statusCode, foreign.json().code]).toEqual([
      route.method,
      route.url,
      404,
      'ROBOT_NOT_FOUND',
    ]);

    const own = await call(route, asUser('admin'));
    expect([route.method, route.url, own.json().code]).not.toEqual([
      route.method,
      route.url,
      'ROBOT_NOT_FOUND',
    ]);
  }
});

test('a malformed robot id is simply not found', async () => {
  const res = await call({ method: 'GET', url: '/api/robots/bad' }, asUser('user'));
  expect(res.statusCode).toBe(404);
});

test('creating, editing and deleting robots is admin only', async () => {
  for (const [method, url] of [
    ['POST', '/api/robots'],
    ['PATCH', '/api/robots/r1'],
    ['DELETE', '/api/robots/r1'],
  ] as const) {
    const res = await call({ method, url }, asUser('user'));
    expect([method, url, res.statusCode]).toEqual([method, url, 403]);
  }
});

test('a robot cannot be created on a map the organization does not have', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/robots',
    headers: asUser('admin'),
    payload: { name: 'new-robot', mapId: 'map-of-another-org' },
  });
  expect(res.statusCode).toBe(404);
  expect(res.json().error).toBe('Map not found');
});

test('every staff route refuses anyone who is not staff', async () => {
  const staffOnly = routes.filter(route => route.url.startsWith('/api/staff'));
  expect(staffOnly.length).toBeGreaterThanOrEqual(10);

  for (const route of staffOnly) {
    for (const who of ['admin', 'user'] as const) {
      const res = await call(route, asUser(who));
      expect([who, route.method, route.url, res.statusCode]).toEqual([
        who,
        route.method,
        route.url,
        403,
      ]);
    }
  }
  expect((await call({ method: 'GET', url: '/api/staff/orgs' }, asUser('staff'))).statusCode).toBe(
    200
  );
});

test('staff act in the organization they entered, and nowhere else', async () => {
  const robot = { method: 'GET', url: '/api/robots/r1' };
  expect((await call(robot, asUser('staff'))).statusCode).toBe(404);
  expect((await call(robot, asStaffIn(ORG_A))).statusCode).toBe(200);
});

test('a plain member can operate a robot their organization owns', async () => {
  for (const [method, url] of [
    ['GET', '/api/robots/r1'],
    ['GET', '/api/robots/r1/maps'],
    ['GET', '/api/robots/r1/current-mission'],
    ['GET', '/api/robots/r1/map-sync'],
    ['GET', '/api/robots/addresses'],
  ] as const) {
    const res = await call({ method, url }, asUser('user'));
    expect([method, url, res.statusCode]).toEqual([method, url, 200]);
  }
});

const createRobot = (payload: object) =>
  app.inject({ method: 'POST', url: '/api/robots', headers: asUser('admin'), payload });

test('an org admin sets any public address, which then waits for approval', async () => {
  const res = await createRobot({ name: 'New', ipAddress: '100.124.198.30', bridgePort: 9090 });
  expect(res.statusCode).toBe(200);
  expect(res.json().data).toMatchObject({ ipAddress: '100.124.198.30', addressStatus: 'PENDING' });
});

test('robot addresses are normalized, and internal ones and hostnames are refused', async () => {
  const mapped = await createRobot({ name: 'Alias', ipAddress: '::ffff:100.124.198.30' });
  expect(mapped.json().data.ipAddress).toBe('100.124.198.30');

  for (const ipAddress of [
    'mongo',
    'robot.example.com',
    '127.0.0.1',
    '169.254.169.254',
    '172.18.0.3',
    '::1',
  ]) {
    const res = await createRobot({ name: 'Bad', ipAddress });
    expect([ipAddress, res.statusCode]).toEqual([ipAddress, 400]);
  }
});

test('an organization cannot exceed its robot limit', async () => {
  process.env['MAX_ROBOTS_PER_ORG'] = '1';
  try {
    const res = await createRobot({ name: 'One too many' });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('ROBOT_LIMIT_REACHED');
  } finally {
    delete process.env['MAX_ROBOTS_PER_ORG'];
  }
});

test('updating a user only ever writes the allowed fields', async () => {
  userUpdates.length = 0;
  const res = await app.inject({
    method: 'PUT',
    url: '/api/users/colleague',
    headers: asUser('admin'),
    payload: {
      displayName: 'Renamed',
      orgId: 'another-org',
      passwordHash: 'attacker-chosen',
      sessions: { create: { token: 'impersonation' } },
    },
  });
  expect(res.statusCode).toBe(200);
  expect(Object.keys(userUpdates[0]).sort()).toEqual(['displayName', 'updatedAt']);
});

test('staff cannot be promoted to through the API, or changed by an org admin', async () => {
  const promote = await app.inject({
    method: 'PUT',
    url: '/api/users/colleague',
    headers: asUser('admin'),
    payload: { role: 'STAFF' },
  });
  expect(promote.statusCode).toBe(400);

  for (const [method, url, payload] of [
    ['PUT', '/api/users/staff-member', { displayName: 'x' }],
    ['DELETE', '/api/users/staff-member', undefined],
    ['POST', '/api/users/staff-member/reset-password', undefined],
  ] as const) {
    const res = await app.inject({
      method,
      url,
      headers: asUser('admin'),
      ...(payload && { payload }),
    });
    expect([method, url, res.statusCode]).toEqual([method, url, 403]);
  }
});

test('an unknown user is a 404 with no database detail in the response', async () => {
  for (const [method, url, payload] of [
    ['PUT', '/api/users/nobody', { displayName: 'x' }],
    ['DELETE', '/api/users/nobody', undefined],
    ['POST', '/api/users/nobody/reset-password', undefined],
  ] as const) {
    const res = await app.inject({
      method,
      url,
      headers: asUser('admin'),
      ...(payload && { payload }),
    });
    expect([method, url, res.statusCode]).toEqual([method, url, 404]);
    expect(res.body).not.toMatch(/prisma|invocation/i);
  }
});

const setupPayload = (overrides: object = {}) => ({
  tempPassword: TEMP_PASSWORD,
  newPassword: 'chosen-password',
  confirmPassword: 'chosen-password',
  ...overrides,
});
const firstTimeSetup = (who: 'needsReset' | 'disabledNeedsReset', payload = setupPayload()) =>
  app.inject({ method: 'POST', url: SELF_GUARDED, headers: asUser(who), payload });

test('a disabled account cannot complete first-time setup, even with the right password', async () => {
  userUpdates.length = 0;
  const res = await firstTimeSetup('disabledNeedsReset');
  expect(res.statusCode).toBe(403);
  expect(res.json().code).toBe('ACCOUNT_DISABLED');
  expect(userUpdates).toEqual([]);
});

const withUserLookup = async (
  method: 'findFirst' | 'findUnique',
  replacement: (args: any) => Promise<unknown>,
  run: () => Promise<void>
) => {
  const original = prisma.user[method];
  prisma.user[method] = replacement;
  try {
    await run();
  } finally {
    prisma.user[method] = original;
  }
};

const createUser = () =>
  app.inject({
    method: 'POST',
    url: '/api/users',
    headers: asUser('admin'),
    payload: { username: 'new-user', email: 'new-user@example.com', role: 'USER' },
  });

test('a database failure while creating a user reveals nothing about the database', async () => {
  await withUserLookup('findFirst', failWithDatabaseError, async () => {
    const res = await createUser();
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Failed to create user');
  });
});

test('creating a user who already exists still says why it failed', async () => {
  await withUserLookup(
    'findFirst',
    async () => ({ id: 'taken' }),
    async () => {
      const res = await createUser();
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('User with this email or username already exists');
    }
  );
});

test('a database failure during first-time setup reveals nothing about the database', async () => {
  await withUserLookup('findUnique', failWithDatabaseError, async () => {
    const res = await firstTimeSetup('needsReset');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Failed to complete first-time setup');
  });
});

test('first-time setup still explains a mistake the user can correct', async () => {
  const wrongTemp = await firstTimeSetup('needsReset', setupPayload({ tempPassword: 'not-it' }));
  expect(wrongTemp.statusCode).toBe(400);
  expect(wrongTemp.json().error).toBe('Invalid temporary password');

  const mismatch = await firstTimeSetup('needsReset', setupPayload({ confirmPassword: 'other' }));
  expect(mismatch.statusCode).toBe(400);
  expect(mismatch.json().error).toBe('Passwords do not match');
});
