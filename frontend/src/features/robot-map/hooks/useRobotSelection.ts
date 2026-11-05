import { useEffect, useState } from 'react';
import type { Robot } from '@/types/robot';
import { robotHasMap } from '../utils/mapSelection';

export { robotHasMap };

interface RobotSelectionOptions {
  suspendAutoMapSync?: boolean;
}

// The robot's active map: prefer the active RobotMap assignment, fall back to the
// legacy mapId (which the backend keeps pointed at the active map).
export function activeMapIdForRobot(robot: Robot | null | undefined): string | null {
  if (!robot) return null;
  return robot.maps?.find(map => map.isActive)?.id ?? robot.mapId ?? null;
}

// The map to show: the current one while some robot still has it, otherwise the first robot's active
// map. A robot can leave at any time (moved to another organization, deleted), taking its map with it.
export function availableMapId(robots: Robot[], currentMapId: string | null): string | null {
  const stillThere = robots.some(
    robot => robot.mapId === currentMapId || robotHasMap(robot, currentMapId)
  );
  if (currentMapId && stillThere) return currentMapId;
  return activeMapIdForRobot(robots.find(robot => activeMapIdForRobot(robot)));
}

export function useRobotSelection(robots: Robot[], options: RobotSelectionOptions = {}) {
  const [selectedRobotId, setSelectedRobotId] = useState<string | null>(null);
  const [activeMapId, setActiveMapId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const activeRobotId =
    selectedRobotId ??
    robots.find(robot => activeMapIdForRobot(robot) === activeMapId && activeMapId)?.id ??
    robots.find(robot => activeMapIdForRobot(robot))?.id ??
    null;

  // Initialize or recover active map when robots load or change
  useEffect(() => {
    if (options.suspendAutoMapSync) return;
    setActiveMapId(availableMapId(robots, activeMapId));
  }, [activeMapId, options.suspendAutoMapSync, robots]);

  // A selected robot can leave too; its id would keep the telemetry and controls pointed at it.
  useEffect(() => {
    if (selectedRobotId && !robots.some(robot => robot.id === selectedRobotId)) {
      setSelectedRobotId(null);
    }
  }, [robots, selectedRobotId]);

  // Keep active map in sync with the selected robot when its active map changes
  useEffect(() => {
    if (options.suspendAutoMapSync) return;
    const selectedRobot = robots.find(robot => robot.id === selectedRobotId);
    const selectedMapId = activeMapIdForRobot(selectedRobot);
    if (selectedMapId && selectedMapId !== activeMapId) {
      setActiveMapId(selectedMapId);
    }
  }, [activeMapId, options.suspendAutoMapSync, robots, selectedRobotId]);

  const handleSelectRobot = (robot: Robot | null) => {
    setSelectedRobotId(robot?.id ?? null);
    const mapId = activeMapIdForRobot(robot);
    if (mapId) {
      setActiveMapId(mapId);
    }
    if (robot) {
      setIsSidebarOpen(true);
    }
  };

  return {
    selectedRobotId,
    setSelectedRobotId,
    activeMapId,
    setActiveMapId,
    isSidebarOpen,
    setIsSidebarOpen,
    activeRobotId,
    handleSelectRobot,
  };
}
