import type { Robot } from '@/types/robot';

// True if the map is one of the robot's assigned maps (falls back to legacy single mapId).
export function robotHasMap(robot: Robot | null | undefined, mapId: string | null | undefined) {
  if (!robot || !mapId) return false;
  if (robot.maps?.length) return robot.maps.some(map => map.id === mapId);
  return robot.mapId === mapId;
}

// Which map to show when a robot + mission are selected: follow the selected
// mission's map (any of the robot's maps), else the robot's active map.
// clearMission is true when a chosen mission isn't on one of the robot's maps.
export function resolveSelectionMap(
  robot: Robot,
  missionId: string | null,
  missions: Array<{ id: string; mapId: string }>
): { mapId: string | null; clearMission: boolean } {
  const selected = missionId
    ? (missions.find(m => m.id === missionId && robotHasMap(robot, m.mapId)) ?? null)
    : null;
  return {
    mapId: selected?.mapId ?? robot.mapId ?? null,
    clearMission: Boolean(missionId) && !selected,
  };
}

// ponytail: self-check in lieu of a test runner. Run: bun src/features/robot-map/utils/mapSelection.ts
if ((import.meta as any).main) {
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error(`FAIL: ${m}`);
  };
  const robot = {
    id: 'r1',
    mapId: 'mA',
    maps: [
      { id: 'mA', name: 'A', isActive: true, isPinned: false, syncedAt: '' },
      { id: 'mB', name: 'B', isActive: false, isPinned: false, syncedAt: '' },
    ],
  } as unknown as Robot;
  const missions = [
    { id: 'm1', mapId: 'mA' },
    { id: 'm2', mapId: 'mB' },
  ];

  // The actual question: click a mission on a DIFFERENT (owned) map -> map switches, mission kept.
  ok(
    resolveSelectionMap(robot, 'm2', missions).mapId === 'mB',
    'cross-map mission switches map to mB'
  );
  ok(
    resolveSelectionMap(robot, 'm2', missions).clearMission === false,
    'cross-map mission is kept'
  );
  // Mission on the active map -> stays.
  ok(resolveSelectionMap(robot, 'm1', missions).mapId === 'mA', 'same-map mission stays on mA');
  // Mission not on any of the robot's maps -> stays on active, selection cleared.
  const unowned = [{ id: 'mX', mapId: 'mZ' }];
  ok(resolveSelectionMap(robot, 'mX', unowned).mapId === 'mA', 'unowned mission stays on active');
  ok(resolveSelectionMap(robot, 'mX', unowned).clearMission === true, 'unowned mission cleared');
  // No mission selected -> active map, nothing cleared.
  ok(resolveSelectionMap(robot, null, missions).mapId === 'mA', 'no mission -> active map');
  ok(resolveSelectionMap(robot, null, missions).clearMission === false, 'no mission -> no clear');
  // Legacy single-map robot (no maps[]).
  const legacy = { id: 'r2', mapId: 'mA' } as unknown as Robot;
  ok(resolveSelectionMap(legacy, 'm1', missions).mapId === 'mA', 'legacy single-map fallback');

  console.log('mapSelection self-check passed');
}
