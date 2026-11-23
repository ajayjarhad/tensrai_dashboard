import { expect, test } from 'bun:test';

// The import rules, compare-and-swap and record splitting against a real Mongo replica set with the
// current schema pushed (Prisma's Mongo connector treats unset and null fields differently, which
// fakes can't show):
//   TEST_DATABASE_URL='mongodb://localhost:27017/tenancy_test?replicaSet=rs0&directConnection=true' bun test integration
const url = process.env['TEST_DATABASE_URL'];

const quietLog = { info() {}, warn() {}, error() {}, debug() {} } as any;
const pgm = (fill: number) => Buffer.concat([Buffer.from('P5\n2 2\n255\n'), Buffer.alloc(4, fill)]);
const files = (fill: number, missions: unknown[] = []) => ({
  map_yaml: 'map.yaml',
  map_pgm: 'map.pgm',
  map_yaml_content: 'image: map.pgm\nresolution: 0.05\norigin: [0, 0, 0]\n',
  map_pgm_content: pgm(fill),
  metadata_json: { locationTags: [], missions },
});

if (url) {
  const { PrismaClient } = await import('@prisma/client');
  const { scopedPrisma } = await import('./orgScope.js');
  const { upsertMapFromResponse } = await import('./mapRecords.js');
  const { backfillMapRevisions } = await import('./mapRevisionBackfill.js');

  const prisma = new PrismaClient({ datasourceUrl: url });
  const run = Date.now().toString(36);
  const org = await prisma.organization.create({
    data: { name: `Maps-${run}`, slug: `maps-${run}` },
  });
  const db = scopedPrisma(prisma, org.id);
  const host = { log: quietLog, prisma: db };
  const robot = async (name: string) =>
    prisma.robot.create({ data: { orgId: org.id, name: `${name}-${run}` } });
  const linkOf = (robotId: string) => db.robotMap.findFirst({ where: { robotId } });

  test('an import records the file name and the revision the robot holds', async () => {
    const r = await robot('first');
    const map = await upsertMapFromResponse(host, r.id, files(10));
    const link = await linkOf(r.id);
    expect(link).toMatchObject({
      filename: 'map.yaml',
      pushedRevision: map?.revision,
      isActive: true,
    });
    expect(map?.imageSha256).toHaveLength(64);
  });

  test('an edit survives the robot sending its older copy, and a change on both sides is a conflict', async () => {
    const r = await robot('edit');
    const map = await upsertMapFromResponse(host, r.id, files(20));
    if (!map) throw new Error('no map');
    await db.map.update({
      where: { id: map.id },
      data: { revision: 'edited-here', editedAt: new Date() },
    });

    await upsertMapFromResponse(host, r.id, files(20));
    expect((await db.map.findUnique({ where: { id: map.id } }))?.revision).toBe('edited-here');
    expect((await linkOf(r.id))?.conflictRevision ?? null).toBeNull();

    await upsertMapFromResponse(host, r.id, files(21));
    const conflicted = await linkOf(r.id);
    expect(conflicted?.conflictRevision).toBeTruthy();
    // The robot's copy is kept beside the conflict, so the choice can show what differs.
    expect(conflicted?.conflictCopy).toMatchObject({ imageSha256: expect.any(String) });
    expect((await db.map.findUnique({ where: { id: map.id } }))?.revision).toBe('edited-here');

    // Taking the robot's copy settles it once.
    await upsertMapFromResponse(host, r.id, files(21), { acceptRobotMapId: map.id });
    const settled = await linkOf(r.id);
    expect(settled?.conflictRevision ?? null).toBeNull();
    expect(settled?.pushedRevision).toBe(conflicted?.conflictRevision);
  });

  test('robots with identical copies share one record, and one that changes splits off', async () => {
    const [a, b] = [await robot('share-a'), await robot('share-b')];
    const shared = await upsertMapFromResponse(host, a.id, files(30));
    const joined = await upsertMapFromResponse(host, b.id, files(30));
    expect(joined?.id).toBe(shared?.id);

    const split = await upsertMapFromResponse(host, b.id, files(31));
    expect(split?.id).not.toBe(shared?.id);
    expect((await linkOf(a.id))?.mapId).toBe(shared?.id);
    expect((await linkOf(b.id))?.mapId).toBe(split?.id);
  });

  test('a save against a stale revision changes nothing', async () => {
    const r = await robot('cas');
    const map = await upsertMapFromResponse(host, r.id, files(40));
    const stale = await db.map.updateMany({
      where: { id: map?.id ?? '', revision: 'not-the-current-one' },
      data: { name: 'lost update' },
    });
    expect(stale.count).toBe(0);
  });

  test('the backfill fills old records once, links included, and finds nothing the second time', async () => {
    const r = await robot('legacy');
    const legacy = await prisma.map.create({
      data: {
        orgId: org.id,
        name: 'Legacy',
        filename: `legacy-${run}.yaml`,
        image: pgm(50),
        metadata: { image: 'legacy.pgm', resolution: 0.05, origin: [0, 0, 0] },
        features: { locationTags: [], missions: [] },
      },
    });
    await prisma.robotMap.create({ data: { orgId: org.id, robotId: r.id, mapId: legacy.id } });

    expect((await backfillMapRevisions(prisma)).maps).toBeGreaterThanOrEqual(1);
    const filled = await prisma.map.findUnique({ where: { id: legacy.id } });
    expect(filled?.revision).toHaveLength(64);
    const link = await linkOf(r.id);
    expect(link).toMatchObject({
      filename: `legacy-${run}.yaml`,
      pushedRevision: filled?.revision,
    });

    expect(await backfillMapRevisions(prisma)).toEqual({ maps: 0, links: 0 });
  });
}
