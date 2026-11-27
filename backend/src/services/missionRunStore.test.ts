import { expect, test } from 'bun:test';
import { MissionRunStore } from './missionRunStore.js';

const smpToFactory = { id: '1', name: 'smp to factory' };
const homeToSmpc = { id: '16', name: 'home to smpc' };

// SSH holds map20, which carries map7's missions copied in by the robot, and map7 itself.
const robotMaps = (activeMapId: string) => [
  {
    mapId: 'map-20',
    isActive: activeMapId === 'map-20',
    map: {
      filename: 'map20.yaml',
      features: { missions: [homeToSmpc, { ...smpToFactory, metadataFile: 'map7' }] },
    },
  },
  {
    mapId: 'map-7',
    isActive: activeMapId === 'map-7',
    map: { filename: 'map7.yaml', features: { missions: [smpToFactory] } },
  },
];

const createStore = (activeMapId: string) => {
  const runs: any[] = [];
  const prisma: any = {
    robotMap: { findMany: async () => robotMaps(activeMapId) },
    missionRun: {
      findUnique: async () => null,
      findFirst: async () => null,
      create: async ({ data }: any) => {
        const run = { id: `run-${runs.length + 1}`, ...data };
        runs.push(run);
        return run;
      },
      update: async ({ where, data }: any) =>
        Object.assign(
          runs.find(run => run.id === where.id),
          data
        ),
    },
  };
  const store = new MissionRunStore(prisma, { error: () => {}, warn: () => {} });
  const showUp = (missionId: number) =>
    store.recordCommandIntent(
      { robotId: 'robot-1', robotName: 'SSH', mapId: activeMapId },
      'SHOW_UP',
      {
        missionId,
      }
    );
  return { showUp, runs };
};

test('a run of a mission copied from another map is recorded on that map', async () => {
  const { showUp, runs } = createStore('map-20');
  await showUp(1);
  expect(runs[0]).toMatchObject({ mapId: 'map-7', missionNameSnapshot: 'smp to factory' });
});

test('a run of a mission on another of the robot’s maps is still named', async () => {
  const { showUp, runs } = createStore('map-7');
  await showUp(16);
  expect(runs[0]).toMatchObject({ mapId: 'map-20', missionNameSnapshot: 'home to smpc' });
});
