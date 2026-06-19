import { useMemo } from 'react';
import type { Robot } from '@/types/robot';
import { sortMissions } from '../utils/missionSort';
import { useRobotMissionsQuery } from './useRobotMissionsQuery';
import { robotHasMap } from './useRobotSelection';

export function useRobotMissions(robots: Robot[], activeMapId: string | null) {
  const { data: allMissions = [], isLoading, error } = useRobotMissionsQuery();

  const missionsWithRobots = useMemo(
    () =>
      allMissions.map(mission => ({
        ...mission,
        // A robot can run a mission if the mission's map is any of the robot's maps.
        availableRobots: robots.filter(r => robotHasMap(r, mission.mapId)),
      })),
    [allMissions, robots]
  );

  const prioritizedMissions = useMemo(() => {
    return sortMissions(missionsWithRobots, activeMapId);
  }, [activeMapId, missionsWithRobots]);

  return {
    missions: prioritizedMissions,
    loading: isLoading,
    error,
  };
}
