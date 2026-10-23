import { expect, test } from 'bun:test';
import cors from '@fastify/cors';
import { asUser, createTestApp, fakeRobotModel, ORG_A } from '../testing/authStub.js';

const { default: mapRoutes } = await import('./maps.js');
const { default: missionRunRoutes } = await import('./missionRuns.js');
const { default: robotRoutes } = await import('./robots.js');
const { default: userRoutes } = await import('./users.js');

// first-time-setup is how a user with a temporary password gets a usable one, so it must
// stay reachable by sessions the guard turns away; it checks the session itself.
const SELF_GUARDED = '/api/auth/first-time-setup';

type RouteInfo = { method: string; url: string };

const prisma = {
  robot: fakeRobotModel([{ id: 'r1', orgId: ORG_A }]),
  map: { findMany: async () => [], findUnique: async () => null },
  user: { findMany: async () => [], findUnique: async () => null },
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
  for (const plugin of [robotRoutes, mapRoutes, missionRunRoutes, userRoutes]) {
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
      payload: { tempPassword: 'x', newPassword: 'xxxx', confirmPassword: 'x' },
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
  expect(userRoutesOnly.length).toBe(5);

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
  const robotIdRoutes = routes.filter(route => route.url.includes('/robots/:id'));
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
