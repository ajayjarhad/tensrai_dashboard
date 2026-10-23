import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';

// Real auth plugin against a real Mongo replica set; see tenancy.integration.test.ts for how to run.
const url = process.env['TEST_DATABASE_URL'];

if (url) {
  const { default: fastify } = await import('fastify');
  const { PrismaClient } = await import('@prisma/client');
  const { default: bcrypt } = await import('bcryptjs');
  const { default: authPlugin } = await import('./auth.js');
  const { default: tenantPlugin } = await import('./tenant.js');
  const { default: robotRoutes } = await import('../routes/robots.js');

  const createFastify = fastify as unknown as () => any;
  const prisma = new PrismaClient({ datasourceUrl: url });
  const run = Date.now().toString(36);
  const password = `pw-${run}`;

  const org = await prisma.organization.create({
    data: { name: `Auth-${run}`, slug: `auth-${run}` },
  });
  const user = await prisma.user.create({
    data: {
      orgId: org.id,
      username: `auth-user-${run}`,
      email: `auth-user-${run}@example.test`,
      role: 'ADMIN',
      passwordHash: await bcrypt.hash(password, 4),
    },
  });

  const app = createFastify();
  app.decorate('prisma', prisma);
  await app.register(authPlugin);
  await app.register(tenantPlugin);
  await app.register(robotRoutes, { prefix: '/api' });
  await app.ready();

  const signIn = () =>
    app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      payload: { username: user.username, password },
    });
  const cookieOf = (res: { headers: Record<string, unknown> }) =>
    String(res.headers['set-cookie']).split(';')[0] ?? '';

  test('a signed-in session is recognized by /api/auth/session without leaking credentials', async () => {
    const login = await signIn();
    expect(login.statusCode).toBe(200);
    const cookie = cookieOf(login);

    const res = await app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user).toMatchObject({ id: user.id, orgId: org.id, orgName: org.name });
    expect(body.session.sessionId).toBeTruthy();
    expect(res.body).not.toMatch(/passwordHash|tempPasswordHash|"token"|sessionToken/);
    expect((await app.inject({ method: 'GET', url: '/api/auth/session' })).statusCode).toBe(401);
  });

  test('sign-out revokes the session on the server, not just in the browser', async () => {
    const cookie = cookieOf(await signIn());
    const robots = () => app.inject({ method: 'GET', url: '/api/robots', headers: { cookie } });
    expect((await robots()).statusCode).toBe(200);

    const out = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: { cookie },
    });
    expect(out.statusCode).toBe(200);
    expect(String(out.headers['set-cookie'])).toMatch(/better-auth\.session_token=;.*Max-Age=0/);

    expect((await robots()).statusCode).toBe(401);
    const session = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie },
    });
    expect(session.statusCode).toBe(401);
    const token = decodeURIComponent(cookie.split('=')[1] ?? '');
    expect(token).not.toBe('');
    expect(await prisma.session.count({ where: { token } })).toBe(0);
  });

  test('signing out with no session is harmless', async () => {
    const out = await app.inject({ method: 'POST', url: '/api/auth/sign-out' });
    expect(out.statusCode).toBe(200);
  });

  test('seeding never overwrites an account that already exists', async () => {
    const seedEnv = {
      ...process.env,
      DATABASE_URL: url,
      SEED_ADMIN_USERNAME: `seed-admin-${run}`,
      SEED_ADMIN_EMAIL: `seed-admin-${run}@example.test`,
      SEED_ADMIN_PASSWORD: `first-${run}`,
      SEED_USER_USERNAME: `seed-user-${run}`,
      SEED_USER_EMAIL: `seed-user-${run}@example.test`,
      SEED_USER_PASSWORD: `first-${run}`,
    };
    const seed = () =>
      spawnSync('bun', [new URL('../../scripts/seed.ts', import.meta.url).pathname], {
        env: seedEnv,
        encoding: 'utf8',
      });

    expect(seed().stdout).toContain('created');
    const created = await prisma.user.findUnique({ where: { username: `seed-admin-${run}` } });
    expect(await bcrypt.compare(`first-${run}`, created?.passwordHash ?? '')).toBe(true);

    // The admin changes their password; the next container start runs the seed again.
    const changedHash = await bcrypt.hash(`changed-${run}`, 4);
    await prisma.user.update({
      where: { username: `seed-admin-${run}` },
      data: { passwordHash: changedHash },
    });
    expect(seed().stdout).toContain('left unchanged');

    const after = await prisma.user.findUnique({ where: { username: `seed-admin-${run}` } });
    expect(after?.passwordHash).toBe(changedHash);
    expect(after?.id).toBe(created?.id);
  });

  test('removes the test data', async () => {
    await app.close();
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.user.deleteMany({
      where: {
        OR: [{ orgId: org.id }, { username: { in: [`seed-admin-${run}`, `seed-user-${run}`] } }],
      },
    });
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.$disconnect();
  });
}
