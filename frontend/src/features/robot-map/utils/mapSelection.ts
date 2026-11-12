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
  // Mission ids restart on every map, so the robot's active map wins when several have this id.
  const selected = missionId
    ? (missions.find(m => m.id === missionId && m.mapId === robot.mapId) ??
      missions.find(m => m.id === missionId && robotHasMap(robot, m.mapId)) ??
      null)
    : null;
  return {
    mapId: selected?.mapId ?? robot.mapId ?? null,
    clearMission: Boolean(missionId) && !selected,
  };
}

// What focusing one of a robot's missions shows. It follows the start flow's own rule: two rules
// would each keep moving the map to their own answer, rendering forever.
export function resolveFocus(
  robot: Robot,
  missionId: string | undefined,
  missions: Array<{ id: string; mapId: string }>
): { mapId: string | null; missionId: string | undefined } {
  const { mapId, clearMission } = resolveSelectionMap(robot, missionId ?? null, missions);
  return { mapId, missionId: missionId && !clearMission ? missionId : undefined };
}
