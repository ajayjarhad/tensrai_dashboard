import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';

// The whole flow on a real Mongo replica set: real auth plugin, real sessions, real registries and
// a real websocket bridge standing in for a robot. See tenancy.integration.test.ts for how to run.
const url = process.env['TEST_DATABASE_URL'];

if (url) {
  // Loopback is blocked by default; the fake robot below lives there.
  process.env['ROBOT_BLOCKED_SUBNETS'] = '';

  const { default: fastify } = await import('fastify');
  const { default: rateLimit } = await import('@fastify/rate-limit');
  const { PrismaClient } = await import('@prisma/client');
  const { default: bcrypt } = await import('bcryptjs');
  const WebSocket = (await import('ws')).default;
  const { WebSocketServer } = await import('ws');
  const { default: auditPlugin } = await import('../plugins/audit.js');
  const { default: authPlugin } = await import('../plugins/auth.js');
  const { appErrorHandler } = await import('../plugins/errorHandler.js');
  const { default: tenantPlugin } = await import('../plugins/tenant.js');
  const { default: robotRoutes } = await import('./robots.js');
  const { default: rosGateway } = await import('./rosGateway.js');
  const { default: staffRoutes } = await import('./staff.js');
  const { default: userRoutes } = await import('./users.js');
  const { EmergencyRegistry } = await import('../services/emergencyRegistry.js');
  const { MissionRegistry } = await import('../services/missionRegistry.js');
  const { scopedPrisma } = await import('../services/orgScope.js');

  const createFastify = fastify as unknown as (options?: object) => any;
  const prisma = new PrismaClient({ datasourceUrl: url });
  const run = Date.now().toString(36);
  const password = `pw-${run}-long`;
  const hash = await bcrypt.hash(password, 4);
  const quietLog = { info() {}, warn() {}, error() {}, debug() {} } as any;

  const makeOrg = (name: string) =>
    prisma.organization.create({ data: { name: `${name}-${run}`, slug: `${name}-${run}` } });
  const makeUser = (name: string, orgId: string, role: 'ADMIN' | 'USER' | 'STAFF') =>
    prisma.user.create({
      data: {
        orgId,
        role,
        username: `${name}-${run}`,
        email: `${name}-${run}@example.test`,
        passwordHash: hash,
      },
    });

  const orgA = await makeOrg('flow-a');
  const orgB = await makeOrg('flow-b');
  const orgStaff = await makeOrg('flow-staff');
  const adminA = await makeUser('admin-a', orgA.id, 'ADMIN');
  const operatorA = await makeUser('operator-a', orgA.id, 'USER');
  const adminB = await makeUser('admin-b', orgB.id, 'ADMIN');
  const staff = await makeUser('staff', orgStaff.id, 'STAFF');
  const createdOrgIds = [orgA.id, orgB.id, orgStaff.id];

  const app = createFastify();
  app.setErrorHandler(appErrorHandler);
  app.decorate('prisma', prisma);
  app.decorate('socketAccessRecheckMs', 50);
  await app.register(auditPlugin);
  await app.register(rateLimit, { global: false });
  const emergencyRegistry = new EmergencyRegistry(prisma, quietLog);
  app.decorate('emergencyRegistry', emergencyRegistry);
  const missionRegistry = new MissionRegistry(prisma, quietLog, {
    rememberNonEmergencyStatus:
      emergencyRegistry.rememberNonEmergencyStatus.bind(emergencyRegistry),
  });
  app.decorate('missionRegistry', missionRegistry);
  await app.register(authPlugin);
  await app.register(tenantPlugin);
  await app.register(rosGateway);
  for (const plugin of [robotRoutes, userRoutes, staffRoutes]) {
    await app.register(plugin, { prefix: '/api' });
  }
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address();

  // A robot: it accepts bridge connections from whoever connects, as real robots do.
  const startBridge = async () => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise(resolve => server.once('listening', resolve));
    return { server, port: (server.address() as { port: number }).port };
  };
  const bridge = await startBridge();
  const bridgeClients = () => bridge.server.clients.size;

  const waitFor = async (predicate: () => boolean | Promise<boolean>, timeoutMs = 2000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (await predicate()) return true;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    return false;
  };
  const settle = () => new Promise(resolve => setTimeout(resolve, 200));

  const cookieOf = (res: { headers: Record<string, unknown> }) =>
    String(res.headers['set-cookie']).split(';')[0] ?? '';
  const signIn = async (username: string, secret = password) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      payload: { username, password: secret },
    });
  const cookieFor = async (user: { username: string }) => cookieOf(await signIn(user.username));

  const adminACookie = await cookieFor(adminA);
  const adminBCookie = await cookieFor(adminB);
  const staffCookie = await cookieFor(staff);

  const call = (cookie: string, method: string, path: string, payload?: object) =>
    app.inject({ method, url: path, headers: { cookie }, ...(payload && { payload }) });

  const robotPayload = (name: string) => ({
    name,
    ipAddress: '127.0.0.1',
    missionBridgePort: bridge.port,
    emergencyBridgePort: bridge.port,
    bridgePort: bridge.port,
  });

  const addressRow = (orgId: string, ip = '127.0.0.1') =>
    prisma.robotAddress.findUnique({ where: { orgId_ip: { orgId, ip } } });

  // -- address ownership: this is what stops one customer reaching another's robot

  let robotAId = '';
  let robotBId = '';

  test('a new address is saved but the backend does not connect to it', async () => {
    const res = await call(adminACookie, 'POST', '/api/robots', robotPayload('Shared bot'));
    expect(res.statusCode).toBe(200);
    expect(res.json().data.addressStatus).toBe('PENDING');
    robotAId = res.json().data.id;

    await settle();
    expect(bridgeClients()).toBe(0);
  });

  test('map sync is refused until the address is approved', async () => {
    await prisma.robot.update({
      where: { id: robotAId },
      data: { mappingBridgePort: bridge.port },
    });
    const res = await call(adminACookie, 'POST', `/api/robots/${robotAId}/map-sync`);
    expect(res.statusCode).toBe(409);
    await settle();
    expect(bridgeClients()).toBe(0);
  });

  test('another org entering the same address gets the same answer and no connection', async () => {
    const res = await call(adminBCookie, 'POST', '/api/robots', robotPayload('Shared bot'));
    expect(res.statusCode).toBe(200);
    expect(res.json().data.addressStatus).toBe('PENDING');
    robotBId = res.json().data.id;

    await settle();
    expect(bridgeClients()).toBe(0);
  });

  test('once staff approve it, the owner connects without a restart', async () => {
    const row = await addressRow(orgA.id);
    const res = await call(staffCookie, 'POST', `/api/staff/addresses/${row?.id}/approve`);
    expect(res.statusCode).toBe(200);

    expect(await waitFor(() => bridgeClients() > 0)).toBe(true);
    const list = await call(adminACookie, 'GET', '/api/robots/addresses');
    expect(list.json().data).toEqual([{ ip: '127.0.0.1', status: 'APPROVED' }]);
  });

  test('approving the same address for a second org is refused while it is held', async () => {
    const before = bridgeClients();
    const row = await addressRow(orgB.id);
    const res = await call(staffCookie, 'POST', `/api/staff/addresses/${row?.id}/approve`);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain(orgA.name);

    await settle();
    expect(bridgeClients()).toBe(before);
    expect((await addressRow(orgB.id))?.status).toBe('PENDING');
  });

  test('the request list shows staff who else asked for the address', async () => {
    const res = await call(staffCookie, 'GET', '/api/staff/addresses');
    const entry = res.json().data.find((a: any) => a.orgId === orgB.id && a.ip === '127.0.0.1');
    expect(entry).toMatchObject({
      orgName: orgB.name,
      requestedBy: adminB.username,
      robots: ['Shared bot'],
      otherOrgs: [{ name: orgA.name, status: 'APPROVED' }],
    });
  });

  test('deleting a robot keeps the address with its org', async () => {
    const extra = await call(adminACookie, 'POST', '/api/robots', {
      name: 'Short lived',
      ipAddress: '100.100.100.100',
    });
    await call(adminACookie, 'DELETE', `/api/robots/${extra.json().data.id}`, {});
    expect(await addressRow(orgA.id, '100.100.100.100')).not.toBeNull();
  });

  test('releasing an address disconnects it, and only then can another org have it', async () => {
    const held = await addressRow(orgA.id);
    const released = await call(staffCookie, 'DELETE', `/api/staff/addresses/${held?.id}`);
    expect(released.statusCode).toBe(200);
    expect(await waitFor(() => bridgeClients() === 0)).toBe(true);
    expect((await prisma.robot.findUnique({ where: { id: robotAId } }))?.ipAddress).toBeNull();

    const row = await addressRow(orgB.id);
    const approved = await call(staffCookie, 'POST', `/api/staff/addresses/${row?.id}/approve`);
    expect(approved.statusCode).toBe(200);
    expect(await waitFor(() => bridgeClients() > 0)).toBe(true);
  });

  test('rejecting an address disconnects it', async () => {
    const row = await addressRow(orgB.id);
    const res = await call(staffCookie, 'POST', `/api/staff/addresses/${row?.id}/reject`);
    expect(res.statusCode).toBe(200);
    expect(await waitFor(() => bridgeClients() === 0)).toBe(true);
  });

  test('staff adding a robot inside an org are approved straight away', async () => {
    await call(staffCookie, 'POST', `/api/staff/orgs/${orgStaff.id}/enter`);
    const res = await call(staffCookie, 'POST', '/api/robots', {
      name: 'Staff added',
      ipAddress: '100.100.100.101',
    });
    expect(res.json().data.addressStatus).toBe('APPROVED');
    await call(staffCookie, 'POST', '/api/staff/exit');
  });

  test('the startup backfill approves existing robots but never a pending request', () => {
    const legacyIp = '100.100.100.102';
    return (async () => {
      const legacy = await prisma.robot.create({
        data: { orgId: orgA.id, name: `legacy-${run}`, ipAddress: legacyIp },
      });
      await prisma.robotAddress.create({
        data: { orgId: orgB.id, ip: '100.100.100.103', status: 'PENDING' },
      });
      await prisma.robot.create({
        data: { orgId: orgB.id, name: `waiting-${run}`, ipAddress: '100.100.100.103' },
      });

      const result = spawnSync(
        'bun',
        [new URL('../../scripts/backfillOrg.ts', import.meta.url).pathname],
        { env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' }
      );
      expect(result.status).toBe(0);

      expect((await addressRow(orgA.id, legacyIp))?.status).toBe('APPROVED');
      expect((await addressRow(orgB.id, '100.100.100.103'))?.status).toBe('PENDING');
      await prisma.robot.delete({ where: { id: legacy.id } });
    })();
  });

  // -- robot operations through the scoped client, which the fakes can't vouch for

  test('active map, its $transaction, edits and cascading delete all work on real data', async () => {
    const mapOne = await prisma.map.create({
      data: {
        orgId: orgA.id,
        name: `one-${run}`,
        filename: `one-${run}.yaml`,
        image: Buffer.from('x'),
        metadata: {},
        features: {},
      },
    });
    const mapTwo = await prisma.map.create({
      data: {
        orgId: orgA.id,
        name: `two-${run}`,
        filename: `two-${run}.yaml`,
        image: Buffer.from('x'),
        metadata: {},
        features: {},
      },
    });

    const created = await call(adminACookie, 'POST', '/api/robots', {
      name: 'Mapper',
      mapId: mapOne.id,
    });
    expect(created.statusCode).toBe(200);
    const id = created.json().data.id;
    await prisma.robotMap.create({ data: { orgId: orgA.id, robotId: id, mapId: mapTwo.id } });

    const operator = await cookieFor(operatorA);
    const active = await call(operator, 'POST', `/api/robots/${id}/active-map`, {
      mapId: mapTwo.id,
    });
    expect(active.statusCode).toBe(200);
    expect(active.json().data.find((m: any) => m.id === mapTwo.id)).toMatchObject({
      isActive: true,
      isPinned: true,
    });
    expect((await prisma.robot.findUnique({ where: { id } }))?.mapId).toBe(mapTwo.id);

    const auto = await call(operator, 'POST', `/api/robots/${id}/active-map/auto`);
    expect(auto.json().data.every((m: any) => m.isPinned === false)).toBe(true);

    const patched = await call(adminACookie, 'PATCH', `/api/robots/${id}`, { name: 'Renamed' });
    expect(patched.json().data.name).toBe('Renamed');

    const runRow = await prisma.missionRun.create({
      data: {
        orgId: orgA.id,
        robotId: id,
        robotNameSnapshot: 'Renamed',
        status: 'COMPLETED',
        phase: 'COMPLETED',
      },
    });

    const removed = await call(adminACookie, 'DELETE', `/api/robots/${id}`, {});
    expect(removed.statusCode).toBe(200);
    expect(await prisma.robotMap.count({ where: { robotId: id } })).toBe(0);
    expect(await prisma.missionRun.findUnique({ where: { id: runRow.id } })).toBeNull();
    await prisma.map.deleteMany({ where: { id: { in: [mapOne.id, mapTwo.id] } } });
  });

  test('robot-map links are scoped like everything else', async () => {
    const map = await prisma.map.create({
      data: {
        orgId: orgB.id,
        name: `links-${run}`,
        filename: `links-${run}.yaml`,
        image: Buffer.from('x'),
        metadata: {},
        features: {},
      },
    });
    const link = await prisma.robotMap.create({
      data: { orgId: orgB.id, robotId: robotBId, mapId: map.id },
    });
    expect(
      await scopedPrisma(prisma, orgA.id).robotMap.findUnique({ where: { id: link.id } })
    ).toBeNull();
    expect((await scopedPrisma(prisma, orgB.id).robotMap.findMany()).map(l => l.id)).toContain(
      link.id
    );
    await prisma.robotMap.delete({ where: { id: link.id } });
    await prisma.map.delete({ where: { id: map.id } });
  });

  // -- staff

  test('staff enter an org, act in it, and exit', async () => {
    const before = await call(staffCookie, 'GET', '/api/robots');
    expect(before.json().data.map((r: any) => r.id)).not.toContain(robotBId);

    await call(staffCookie, 'POST', `/api/staff/orgs/${orgB.id}/enter`);
    const inside = await call(staffCookie, 'GET', '/api/robots');
    expect(inside.json().data.map((r: any) => r.id)).toContain(robotBId);
    const session = await call(staffCookie, 'GET', '/api/auth/session');
    expect(session.json().user).toMatchObject({
      orgId: orgB.id,
      orgName: orgB.name,
      homeOrgId: orgStaff.id,
    });

    await call(staffCookie, 'POST', '/api/staff/exit');
    const after = await call(staffCookie, 'GET', '/api/robots');
    expect(after.json().data.map((r: any) => r.id)).not.toContain(robotBId);
  });

  test('a taken username does not leave an org behind', async () => {
    const res = await call(staffCookie, 'POST', '/api/staff/orgs', {
      name: `dead-end-${run}`,
      slug: `dead-end-${run}`,
      username: adminA.username,
      email: `fresh-${run}@example.test`,
    });
    expect(res.statusCode).toBe(409);
    expect(await prisma.organization.findFirst({ where: { name: `dead-end-${run}` } })).toBeNull();

    const created = await call(staffCookie, 'POST', '/api/staff/orgs', {
      name: `fresh-${run}`,
      slug: `fresh-${run}`,
      username: `fresh-admin-${run}`,
      email: `fresh-${run}@example.test`,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.tempPassword).toBeTruthy();
    createdOrgIds.push(created.json().data.org.id);

    const orgs = await call(staffCookie, 'GET', '/api/staff/orgs');
    const listed = orgs.json().data.find((o: any) => o.id === created.json().data.org.id);
    expect(listed).toMatchObject({ users: 1, robots: 0, pendingAddresses: 0 });
  });

  test('an address approved ahead of time connects as soon as the org uses it', async () => {
    const ip = '100.100.100.120';
    const ahead = await call(staffCookie, 'POST', `/api/staff/orgs/${orgA.id}/addresses`, { ip });
    expect(ahead.statusCode).toBe(201);

    const robot = await call(adminACookie, 'POST', '/api/robots', {
      name: 'Pre-approved',
      ipAddress: ip,
    });
    expect(robot.json().data.addressStatus).toBe('APPROVED');

    const heldElsewhere = await call(staffCookie, 'POST', `/api/staff/orgs/${orgB.id}/addresses`, {
      ip,
    });
    expect(heldElsewhere.statusCode).toBe(409);

    const internal = await call(staffCookie, 'POST', `/api/staff/orgs/${orgA.id}/addresses`, {
      ip: 'mongo',
    });
    expect(internal.statusCode).toBe(400);
  });

  test('staff can add a second admin to an org, who can then sign in', async () => {
    const res = await call(staffCookie, 'POST', `/api/staff/orgs/${orgB.id}/admins`, {
      username: `second-admin-${run}`,
      email: `second-admin-${run}@example.test`,
    });
    expect(res.statusCode).toBe(201);

    const login = await signIn(`second-admin-${run}`, res.json().data.tempPassword);
    expect(login.json().user).toMatchObject({ orgId: orgB.id, role: 'ADMIN' });

    const unknownOrg = await call(
      staffCookie,
      'POST',
      '/api/staff/orgs/64b00000000000000000ffff/admins',
      {
        username: `orphan-${run}`,
        email: `orphan-${run}@example.test`,
      }
    );
    expect(unknownOrg.statusCode).toBe(404);
  });

  test('moving a robot takes its maps, runs and address, and refuses to split anything', async () => {
    const ip = '100.100.100.110';
    const mover = await prisma.robot.create({
      data: { orgId: orgA.id, name: `mover-${run}`, ipAddress: ip },
    });
    await prisma.robotAddress.create({ data: { orgId: orgA.id, ip, status: 'APPROVED' } });
    const map = await prisma.map.create({
      data: {
        orgId: orgA.id,
        name: `moved-${run}`,
        filename: `moved-${run}.yaml`,
        image: Buffer.from('x'),
        metadata: {},
        features: {},
      },
    });
    await prisma.robotMap.create({ data: { orgId: orgA.id, robotId: mover.id, mapId: map.id } });
    await prisma.missionRun.create({
      data: {
        orgId: orgA.id,
        robotId: mover.id,
        robotNameSnapshot: 'mover',
        status: 'COMPLETED',
        phase: 'COMPLETED',
      },
    });

    const move = (robotId: string, orgId: string) =>
      call(staffCookie, 'POST', `/api/staff/robots/${robotId}/move`, { orgId });

    // A name already taken in the destination.
    const clash = await prisma.robot.create({ data: { orgId: orgB.id, name: `mover-${run}` } });
    expect((await move(mover.id, orgB.id)).statusCode).toBe(409);
    await prisma.robot.delete({ where: { id: clash.id } });

    // A map another robot still uses.
    const sibling = await prisma.robot.create({ data: { orgId: orgA.id, name: `sibling-${run}` } });
    const siblingLink = await prisma.robotMap.create({
      data: { orgId: orgA.id, robotId: sibling.id, mapId: map.id },
    });
    expect((await move(mover.id, orgB.id)).statusCode).toBe(409);
    await prisma.robotMap.delete({ where: { id: siblingLink.id } });
    await prisma.robot.delete({ where: { id: sibling.id } });

    expect((await move(mover.id, orgB.id)).statusCode).toBe(200);
    expect((await prisma.robot.findUnique({ where: { id: mover.id } }))?.orgId).toBe(orgB.id);
    expect((await prisma.map.findUnique({ where: { id: map.id } }))?.orgId).toBe(orgB.id);
    expect(await prisma.missionRun.count({ where: { robotId: mover.id, orgId: orgB.id } })).toBe(1);
    expect(await prisma.robotMap.count({ where: { robotId: mover.id, orgId: orgB.id } })).toBe(1);
    expect((await addressRow(orgB.id, ip))?.status).toBe('APPROVED');
    expect(await addressRow(orgA.id, ip)).toBeNull();
    expect((await call(adminACookie, 'GET', `/api/robots/${mover.id}`)).statusCode).toBe(404);
    expect((await call(adminBCookie, 'GET', `/api/robots/${mover.id}`)).statusCode).toBe(200);
  });

  // -- users and sessions

  test('reset-password replaces the password and ends the user’s sessions', async () => {
    const user = await makeUser('forgetful', orgA.id, 'USER');
    const oldCookie = await cookieFor(user);
    expect((await call(oldCookie, 'GET', '/api/robots')).statusCode).toBe(200);

    const res = await call(adminACookie, 'POST', `/api/users/${user.id}/reset-password`);
    expect(res.statusCode).toBe(200);
    const { tempPassword } = res.json().data;

    expect((await call(oldCookie, 'GET', '/api/robots')).statusCode).toBe(401);
    expect((await signIn(user.username)).json().success).toBe(false);

    const withTemp = await signIn(user.username, tempPassword);
    expect(withTemp.json().success).toBe(true);
    expect((await call(cookieOf(withTemp), 'GET', '/api/robots')).statusCode).toBe(428);
  });

  test('an org admin cannot reset a password in another org', async () => {
    const res = await call(adminBCookie, 'POST', `/api/users/${operatorA.id}/reset-password`);
    expect(res.statusCode).toBe(404);
  });

  test('a session in use renews itself, and a fresh one is left alone', async () => {
    const cookie = await cookieFor(operatorA);
    const token = decodeURIComponent(cookie.split('=')[1] ?? '');

    const fresh = await call(cookie, 'GET', '/api/robots');
    expect(fresh.headers['set-cookie']).toBeUndefined();

    const fiveDays = 5 * 24 * 60 * 60 * 1000;
    const thirteenHoursAgo = Date.now() - 13 * 60 * 60 * 1000;
    const aging = new Date(thirteenHoursAgo + fiveDays);
    await prisma.session.updateMany({ where: { token }, data: { expiresAt: aging } });

    const renewed = await call(cookie, 'GET', '/api/robots');
    expect(renewed.statusCode).toBe(200);
    expect(String(renewed.headers['set-cookie'])).toContain('better-auth.session_token=');

    const row = await prisma.session.findUnique({ where: { token } });
    expect(row?.expiresAt.getTime()).toBeGreaterThan(aging.getTime());
  });

  // -- sockets

  const openSocket = async (cookie: string, robotId: string) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/robots/${robotId}/emergency/t`, {
      headers: { cookie },
    } as any);
    const closed = new Promise<number>(resolve => socket.on('close', code => resolve(code)));
    await new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    return { socket, closed };
  };

  test('an open socket is closed when its session ends', async () => {
    const cookie = await cookieFor(adminB);
    const { closed } = await openSocket(cookie, robotBId);
    const token = decodeURIComponent(cookie.split('=')[1] ?? '');
    await prisma.session.deleteMany({ where: { token } });
    expect(await closed).toBe(4401);
  });

  test('an open socket is closed when its user is disabled', async () => {
    const user = await makeUser('to-disable', orgB.id, 'USER');
    const { closed } = await openSocket(await cookieFor(user), robotBId);
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    expect(await closed).toBe(4401);
  });

  test('an e-stop is audited with who sent it and for which org', async () => {
    const operator = await makeUser('stopper', orgB.id, 'USER');
    const { socket } = await openSocket(await cookieFor(operator), robotBId);
    socket.send(JSON.stringify({ event: 'SOFTWARE_EMERGENCY', payload: { status: true } }));

    const recorded = await waitFor(
      async () =>
        (await prisma.auditLog.count({
          where: { userId: operator.id, action: 'SOFTWARE_EMERGENCY', orgId: orgB.id },
        })) === 1
    );
    socket.close();
    expect(recorded).toBe(true);
  });

  // -- sign-in

  test('every sign-in failure looks the same, and sign-ins are recorded', async () => {
    const disabled = await makeUser('disabled', orgA.id, 'USER');
    await prisma.user.update({ where: { id: disabled.id }, data: { isActive: false } });

    const unknown = await signIn(`nobody-${run}`);
    const wrong = await signIn(adminA.username, 'wrong-password');
    const inactive = await signIn(disabled.username);
    expect(unknown.json().error).toBe('Invalid username or password');
    expect(wrong.json().error).toBe(unknown.json().error);
    expect(inactive.json().error).toBe(unknown.json().error);
    expect([wrong.statusCode, inactive.statusCode]).toEqual([
      unknown.statusCode,
      unknown.statusCode,
    ]);

    expect(
      await prisma.auditLog.count({ where: { userId: adminA.id, action: 'LOGIN', orgId: orgA.id } })
    ).toBeGreaterThan(0);
  });

  test('repeated sign-in attempts for an account are rate limited', async () => {
    const username = `limited-${run}`;
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      statuses.push((await signIn(username, 'guess')).statusCode);
    }
    expect(statuses.slice(0, 10).every(status => status === 400)).toBe(true);
    expect(statuses[10]).toBe(429);
    expect((await signIn(adminB.username)).statusCode).toBe(200);
  });

  test('requests a client got wrong are answered as 4xx, not as server errors', async () => {
    const invalid = await call(adminACookie, 'PUT', `/api/users/${operatorA.id}`, {
      role: 'STAFF',
    });
    expect(invalid.statusCode).toBe(400);

    const malformed = await app.inject({
      method: 'POST',
      url: '/api/robots',
      headers: { cookie: adminACookie, 'content-type': 'application/json' },
      payload: '{not json',
    });
    expect(malformed.statusCode).toBe(400);
  });

  test('removes the test data', async () => {
    delete process.env['ROBOT_BLOCKED_SUBNETS'];
    emergencyRegistry.stop();
    missionRegistry.stop();
    await app.close();
    await new Promise(resolve => bridge.server.close(resolve));

    await prisma.session.deleteMany({ where: { user: { orgId: { in: createdOrgIds } } } });
    for (const collection of ['robotAddress', 'auditLog', 'missionRun', 'robotMap']) {
      await (prisma as any)[collection].deleteMany({ where: { orgId: { in: createdOrgIds } } });
    }
    await prisma.map.deleteMany({ where: { orgId: { in: createdOrgIds } } });
    await prisma.robot.deleteMany({ where: { orgId: { in: createdOrgIds } } });
    await prisma.user.deleteMany({ where: { orgId: { in: createdOrgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
    await prisma.$disconnect();
  });
}
