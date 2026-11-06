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
