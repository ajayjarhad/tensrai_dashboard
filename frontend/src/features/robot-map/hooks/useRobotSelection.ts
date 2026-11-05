import { useEffect, useState } from 'react';
import type { Robot } from '@/types/robot';

export { robotHasMap } from '../utils/mapSelection';

interface RobotSelectionOptions {
  suspendAutoMapSync?: boolean;
}

// The robot's active map: prefer the active RobotMap assignment, fall back to the
// legacy mapId (which the backend keeps pointed at the active map).
export function activeMapIdForRobot(robot: Robot | null | undefined): string | null {
  if (!robot) return null;
  return robot.maps?.find(map => map.isActive)?.id ?? robot.mapId ?? null;
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
    if (activeMapId) return;
    const firstWithMap = robots.find(robot => activeMapIdForRobot(robot));
    const firstMapId = activeMapIdForRobot(firstWithMap);
    if (firstMapId) {
      setActiveMapId(firstMapId);
    }
  }, [activeMapId, options.suspendAutoMapSync, robots]);

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
