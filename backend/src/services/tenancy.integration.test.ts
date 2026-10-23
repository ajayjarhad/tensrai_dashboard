import { expect, test } from 'bun:test';

// Runs against a real Mongo replica set with the current schema pushed:
//   TEST_DATABASE_URL='mongodb://localhost:27117/tenancy_test?replicaSet=rs0&directConnection=true' bun test
// Without it the suite registers no tests, so a plain `bun test` stays database-free.
const url = process.env['TEST_DATABASE_URL'];

const quietLog = { info() {}, warn() {}, error() {}, debug() {} } as any;
const makePgm = (fill: number) =>
  Buffer.concat([Buffer.from('P5\n2 2\n255\n'), Buffer.alloc(4, fill)]);
const mapFiles = (fill: number) => ({
  map_yaml: 'map.yaml',
  map_pgm: 'map.pgm',
  map_yaml_content: 'image: map.pgm\nresolution: 0.05\norigin: [0, 0, 0]\n',
  map_pgm_content: makePgm(fill),
  metadata_json: { locationTags: [], missions: [] },
});

if (url) {
  const { PrismaClient } = await import('@prisma/client');
  const { scopedPrisma } = await import('./orgScope.js');
  const { upsertMapFromResponse } = await import('./saveMapFromMapping.js');
  const { MissionRunStore } = await import('./missionRunStore.js');
  const { createUserWithTempPassword, getAllUsers } = await import('./user.service.js');

  const prisma = new PrismaClient({ datasourceUrl: url });
  const run = Date.now().toString(36);
  const orgA = await prisma.organization.create({ data: { name: `A-${run}`, slug: `a-${run}` } });
  const orgB = await prisma.organization.create({ data: { name: `B-${run}`, slug: `b-${run}` } });
  const dbA = scopedPrisma(prisma, orgA.id);
  const dbB = scopedPrisma(prisma, orgB.id);

  const robotA = await prisma.robot.create({ data: { orgId: orgA.id, name: 'Shift Medium' } });
  const robotB = await prisma.robot.create({ data: { orgId: orgB.id, name: 'Shift Medium' } });

  test('the same robot name is allowed in two organizations but not twice in one', async () => {
    expect(robotA.name).toBe(robotB.name);
    await expect(
      Promise.resolve(prisma.robot.create({ data: { orgId: orgA.id, name: 'Shift Medium' } }))
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  test('a scoped client reads only its own organization', async () => {
    expect((await dbA.robot.findMany()).map(robot => robot.id)).toEqual([robotA.id]);
    expect(await dbA.robot.findUnique({ where: { id: robotB.id } })).toBeNull();
    expect(await dbA.robot.findFirst({ where: { name: 'Shift Medium', orgId: orgB.id } })).toEqual(
      expect.objectContaining({ id: robotA.id })
    );
    expect(await dbA.robot.count()).toBe(1);
  });

  test('a scoped client cannot change or delete another organization’s rows', async () => {
    await expect(
      Promise.resolve(dbA.robot.update({ where: { id: robotB.id }, data: { battery: 1 } }))
    ).rejects.toMatchObject({ code: 'P2025' });
    expect((await dbA.robot.updateMany({ where: {}, data: { battery: 2 } })).count).toBe(1);
    expect((await dbA.robot.deleteMany({ where: { id: robotB.id } })).count).toBe(0);
    await expect(
      Promise.resolve(dbA.robot.delete({ where: { id: robotB.id } }))
    ).rejects.toMatchObject({
      code: 'P2025',
    });

    const stillThere = await prisma.robot.findUnique({ where: { id: robotB.id } });
    expect(stillThere?.battery).toBeNull();
    expect((await prisma.robot.findUnique({ where: { id: robotA.id } }))?.battery).toBe(2);
  });

  test('rows created through a scoped client belong to its organization', async () => {
    const created = await dbB.robot.create({ data: { name: 'Second' } as any });
    expect(created.orgId).toBe(orgB.id);
    expect(await dbA.robot.findUnique({ where: { id: created.id } })).toBeNull();
  });

  test('user listing is per organization while usernames stay unique everywhere', async () => {
    const admin = {
      username: `admin-${run}`,
      email: `admin-${run}@a.test`,
      role: 'ADMIN' as const,
    };
    const { user } = await createUserWithTempPassword(prisma, admin, orgA.id, 'SYSTEM', orgA.id);
    expect(user.username).toBe(admin.username);

    expect((await getAllUsers(dbA)).map(u => u.id)).toContain(user.id);
    expect((await getAllUsers(dbB)).map(u => u.id)).not.toContain(user.id);

    await expect(
      createUserWithTempPassword(prisma, admin, orgB.id, 'SYSTEM', orgB.id)
    ).rejects.toThrow('already exists');
  });

  test('syncing the same map filename in two organizations keeps two separate maps', async () => {
    await upsertMapFromResponse({ log: quietLog, prisma }, robotA.id, mapFiles(10));
    await upsertMapFromResponse({ log: quietLog, prisma }, robotB.id, mapFiles(200));
    await upsertMapFromResponse({ log: quietLog, prisma }, robotA.id, mapFiles(11));

    const mapsA = await dbA.map.findMany();
    const mapsB = await dbB.map.findMany();
    expect([mapsA.length, mapsB.length]).toEqual([1, 1]);
    expect(mapsA[0]?.filename).toBe(mapsB[0]?.filename ?? '');
    expect(mapsA[0]?.id).not.toBe(mapsB[0]?.id);
    expect(mapsA[0]?.image.at(-1)).toBe(11);
    expect(mapsB[0]?.image.at(-1)).toBe(200);
    expect(await dbA.map.findUnique({ where: { id: mapsB[0]?.id ?? '' } })).toBeNull();
  });

  test('mission runs are stamped with the robot’s organization and listed per organization', async () => {
    const store = new MissionRunStore(prisma, quietLog);
    const created = await store.recordCommandIntent(
      { robotId: robotA.id, robotName: robotA.name },
      'SHOW_UP',
      { missionId: '7', requestId: 'req-1' }
    );
    expect(created?.orgId).toBe(orgA.id);

    expect((await store.listRuns({ orgId: orgA.id })).map((r: { id: string }) => r.id)).toEqual([
      created?.id,
    ]);
    expect(await store.listRuns({ orgId: orgB.id })).toEqual([]);
    expect((await dbB.missionRun.findMany()).length).toBe(0);
  });

  test('removes the test organizations', async () => {
    for (const orgId of [orgA.id, orgB.id]) {
      await prisma.missionRun.deleteMany({ where: { orgId } });
      await prisma.map.deleteMany({ where: { orgId } });
      await prisma.robotMap.deleteMany({ where: { robot: { orgId } } });
      await prisma.robot.deleteMany({ where: { orgId } });
      await prisma.user.deleteMany({ where: { orgId } });
    }
    await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
    await prisma.$disconnect();
  });
}
