import { useEffect, useState } from 'react';
import type { Robot } from '../../../types/robot';
import { EmergencyHeader } from '../../emergency-stop/emergency-header';
import { useRobots } from '../hooks/useRobots';
import { OccupancyMap } from './OccupancyMap';
import { RobotSidebar } from './RobotSidebar';

export function Dashboard() {
  const { data: robots = [] } = useRobots();
  const [selectedRobotId, setSelectedRobotId] = useState<string | null>(null);
  const [activeMapId, setActiveMapId] = useState<string | null>(null);

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // Initialize or recover active map when robots load or change
  useEffect(() => {
    if (activeMapId) return;
    const firstWithMap = robots.find(robot => robot.mapId);
    if (firstWithMap?.mapId) {
      setActiveMapId(firstWithMap.mapId);
    }
  }, [activeMapId, robots]);

  // Keep active map in sync with the selected robot when its map changes
  useEffect(() => {
    const selectedRobot = robots.find(robot => robot.id === selectedRobotId);
    if (selectedRobot?.mapId && selectedRobot.mapId !== activeMapId) {
      setActiveMapId(selectedRobot.mapId);
    }
  }, [activeMapId, robots, selectedRobotId]);

  const handleSelectRobot = (robot: Robot | null) => {
    setSelectedRobotId(robot?.id ?? null);
    if (robot?.mapId) {
      setActiveMapId(robot.mapId);
    }
  };

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden bg-background relative">
      <EmergencyHeader className="flex-shrink-0 z-20 relative" />
      <div className="flex flex-1 overflow-hidden relative w-full">
        <div className="flex-1 relative min-w-0">
          {activeMapId ? (
            <OccupancyMap
              mapId={activeMapId}
              onMapChange={setActiveMapId}
              width="100%"
              height="100%"
              enablePanning={true}
              enableZooming={true}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              {robots.length > 0 ? 'Select a robot to view map' : 'No robots available'}
            </div>
          )}
        </div>

        <RobotSidebar
          robots={robots}
          selectedRobotId={selectedRobotId}
          onSelectRobot={handleSelectRobot}
          isOpen={isSidebarOpen}
          onToggle={() => setIsSidebarOpen(!isSidebarOpen)}
          className="flex-shrink-0 border-l border-border bg-card z-10 shadow-xl"
        />
      </div>
    </div>
  );
}
