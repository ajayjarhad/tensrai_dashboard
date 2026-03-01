import { useEffect, useState } from 'react';
import type { Robot } from '@/types/robot';

interface RobotSelectionOptions {
  suspendAutoMapSync?: boolean;
}

export function useRobotSelection(robots: Robot[], options: RobotSelectionOptions = {}) {
  const [selectedRobotId, setSelectedRobotId] = useState<string | null>(null);
  const [activeMapId, setActiveMapId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const activeRobotId =
    selectedRobotId ??
    robots.find(robot => robot.mapId && robot.mapId === activeMapId)?.id ??
    robots.find(robot => robot.mapId)?.id ??
    null;

  // Initialize or recover active map when robots load or change
  useEffect(() => {
    if (options.suspendAutoMapSync) return;
    if (activeMapId) return;
    const firstWithMap = robots.find(robot => robot.mapId);
    if (firstWithMap?.mapId) {
      setActiveMapId(firstWithMap.mapId);
    }
  }, [activeMapId, options.suspendAutoMapSync, robots]);

  // Keep active map in sync with the selected robot when its map changes
  useEffect(() => {
    if (options.suspendAutoMapSync) return;
    const selectedRobot = robots.find(robot => robot.id === selectedRobotId);
    if (selectedRobot?.mapId && selectedRobot.mapId !== activeMapId) {
      setActiveMapId(selectedRobot.mapId);
    }
  }, [activeMapId, options.suspendAutoMapSync, robots, selectedRobotId]);

  const handleSelectRobot = (robot: Robot | null) => {
    setSelectedRobotId(robot?.id ?? null);
    if (robot?.mapId) {
      setActiveMapId(robot.mapId);
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
