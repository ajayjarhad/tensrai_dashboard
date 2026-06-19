import { expect, test } from 'bun:test';

const { syncRobotStatusUpdate } = await import('./robotStatusSync.js');

const createLogger = () => ({ error: () => {} }) as any;

const createPrisma = (opts: { robot?: any; robotMaps?: any[]; maps?: any[] } = {}) => {
  const robotRow = opts.robot ?? { battery: 50, status: 'AUTONOMOUS', lastSeen: new Date() };
  const robotMaps = (opts.robotMaps ?? []).map(r => ({ ...r }));
  const maps = opts.maps ?? [];
  const robotUpdates: any[] = [];

  const withMap = (rm: any) => ({ ...rm, map: maps.find(m => m.id === rm.mapId) ?? null });
  const findRow = (key: any) =>
    robotMaps.find(r => r.robotId === key.robotId && r.mapId === key.mapId);

  const prisma: any = {
    robot: {
      findUnique: async () => ({ ...robotRow }),
      update: async (args: any) => {
        robotUpdates.push(args);
        return { id: args.where.id, ...args.data };
      },
    },
    robotMap: {
      findMany: async ({ where }: any) =>
        robotMaps.filter(r => r.robotId === where.robotId).map(withMap),
      update: async ({ where, data }: any) => {
        const row = findRow(where.robotId_mapId);
        if (row) Object.assign(row, data);
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const r of robotMaps) {
          if (r.robotId === where.robotId) {
            Object.assign(r, data);
            count += 1;
          }
        }
        return { count };
      },
    },
    $transaction: async (ops: any[]) => Promise.all(ops),
  };
  return { prisma, robotMaps, robotUpdates };
};

const deps = (prisma: any) => ({ prisma, log: createLogger() });

test('currentMap activates the matching map by filename stem', async () => {
  const { prisma, robotMaps } = createPrisma({
    maps: [
      { id: 'mA', filename: 'map.yaml', features: {} },
      { id: 'mB', filename: 'map1.yaml', features: {} },
    ],
    robotMaps: [
      { robotId: 'r1', mapId: 'mA', isActive: true, isPinned: false },
      { robotId: 'r1', mapId: 'mB', isActive: false, isPinned: false },
    ],
  });

  const result = await syncRobotStatusUpdate(deps(prisma), 'r1', {
    mode: 'autonomous',
    currentMap: 'map1',
  });

  expect(result.ok).toBe(true);
  expect(robotMaps.find(r => r.mapId === 'mB')).toMatchObject({ isActive: true });
  expect(robotMaps.find(r => r.mapId === 'mA')).toMatchObject({ isActive: false });
});

test('falls back to currentMissionId when currentMap is absent', async () => {
  const { prisma, robotMaps } = createPrisma({
    maps: [
      { id: 'mA', filename: 'map.yaml', features: { missions: [{ id: '1' }] } },
      { id: 'mB', filename: 'map1.yaml', features: { missions: [{ id: '7' }] } },
    ],
    robotMaps: [
      { robotId: 'r1', mapId: 'mA', isActive: true, isPinned: false },
      { robotId: 'r1', mapId: 'mB', isActive: false, isPinned: false },
    ],
  });

  await syncRobotStatusUpdate(deps(prisma), 'r1', {
    mode: 'autonomous',
    mission: { currentMissionId: 7 },
  });

  expect(robotMaps.find(r => r.mapId === 'mB')).toMatchObject({ isActive: true });
  expect(robotMaps.find(r => r.mapId === 'mA')).toMatchObject({ isActive: false });
});

test('does not change the active map when a row is pinned', async () => {
  const { prisma, robotMaps } = createPrisma({
    maps: [
      { id: 'mA', filename: 'map.yaml', features: {} },
      { id: 'mB', filename: 'map1.yaml', features: {} },
    ],
    robotMaps: [
      { robotId: 'r1', mapId: 'mA', isActive: true, isPinned: true },
      { robotId: 'r1', mapId: 'mB', isActive: false, isPinned: false },
    ],
  });

  await syncRobotStatusUpdate(deps(prisma), 'r1', { mode: 'autonomous', currentMap: 'map1' });

  expect(robotMaps.find(r => r.mapId === 'mA')).toMatchObject({ isActive: true });
  expect(robotMaps.find(r => r.mapId === 'mB')).toMatchObject({ isActive: false });
});

test('ignores an unknown currentMap stem', async () => {
  const { prisma, robotMaps } = createPrisma({
    maps: [{ id: 'mA', filename: 'map.yaml', features: {} }],
    robotMaps: [{ robotId: 'r1', mapId: 'mA', isActive: true, isPinned: false }],
  });

  await syncRobotStatusUpdate(deps(prisma), 'r1', { mode: 'autonomous', currentMap: 'nope' });

  expect(robotMaps.find(r => r.mapId === 'mA')).toMatchObject({ isActive: true });
});

test('missing currentMap (and no mission) does not break status sync or touch maps', async () => {
  const { prisma, robotMaps, robotUpdates } = createPrisma({
    robot: { battery: 50, status: 'AUTONOMOUS', lastSeen: new Date() },
    maps: [{ id: 'mA', filename: 'map.yaml', features: {} }],
    robotMaps: [{ robotId: 'r1', mapId: 'mA', isActive: true, isPinned: false }],
  });

  // A normal ~30s status tick with no currentMap and no mission.
  const result = await syncRobotStatusUpdate(deps(prisma), 'r1', {
    mode: 'autonomous',
    batteryPercentage: 80,
  });

  expect(result.ok).toBe(true);
  // Normal field sync still happens.
  expect(robotUpdates.some(u => u.data?.battery === 80)).toBe(true);
  // No auto-follow signal -> maps untouched.
  expect(robotMaps.find(r => r.mapId === 'mA')).toMatchObject({ isActive: true });
});
