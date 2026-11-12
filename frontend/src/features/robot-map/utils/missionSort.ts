import type { MissionWithContext } from '../types';

/**
 * Sorts missions based on:
 * 0: On active map AND has robots
 * 1: Has robots (other maps)
 * 2: No robots
 * Then alphabetically by name.
 */
export function sortMissions(
  missions: MissionWithContext[],
  activeMapId: string | null
): MissionWithContext[] {
  const withPriority = missions.map(mission => {
    const hasRobots = (mission.availableRobots?.length ?? 0) > 0;
    const onTargetMap = activeMapId && mission.mapId === activeMapId;

    // Priority order:
    // 0: on active map AND has robots
    // 1: has robots (other maps)
    // 2: no robots
    const priority = onTargetMap && hasRobots ? 0 : hasRobots ? 1 : 2;
    return { mission, priority };
  });

  withPriority.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.mission.name.localeCompare(b.mission.name);
  });

  return withPriority.map(entry => entry.mission);
}
