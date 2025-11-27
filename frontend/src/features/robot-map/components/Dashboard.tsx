import { useEffect, useState } from 'react';
import type { Robot } from '../../../types/robot';
import { EmergencyHeader } from '../../emergency-stop/emergency-header';
import { useRobotTelemetry } from '@/hooks/useRobotTelemetry';
import { useRobots } from '../hooks/useRobots';
import { useRobotTelemetryStore } from '@/stores/robotTelemetry';
import { OccupancyMap } from './OccupancyMap';
import { RobotSidebar } from './RobotSidebar';

export function Dashboard() {
  const { data: robots = [] } = useRobots();
  const [selectedRobotId, setSelectedRobotId] = useState<string | null>(null);
  const [activeMapId, setActiveMapId] = useState<string | null>(null);
  const activeRobotId = selectedRobotId ?? robots.find(robot => robot.mapId)?.id ?? null;
  const { telemetry } = useRobotTelemetry(activeRobotId);
  const telemetryStore = useRobotTelemetryStore();

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // Keep all robot telemetry sockets connected so data flows regardless of selection.
  useEffect(() => {
    const ids = robots.map(r => r.id);
    ids.forEach(id => telemetryStore.connect(id));

    // Disconnect sockets for robots no longer in the list
    const currentIds = new Set(ids);
    Object.keys(telemetryStore.telemetry).forEach(id => {
      if (!currentIds.has(id)) {
        telemetryStore.disconnect(id);
      }
    });
  }, [robots, telemetryStore]);

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
    if (robot) {
      setIsSidebarOpen(true);
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
              robots={robots.map(robot => {
                if (
                  robot.id === activeRobotId &&
                  telemetry?.pose &&
                  Number.isFinite(telemetry.pose.x) &&
                  Number.isFinite(telemetry.pose.y) &&
                  Number.isFinite(telemetry.pose.theta)
                ) {
                  return {
                    ...robot,
                    x: telemetry.pose.x,
                    y: telemetry.pose.y,
                    theta: telemetry.pose.theta,
                  };
                }
                return robot;
              })}
              telemetryRobotId={activeRobotId}
              telemetry={telemetry}
              selectedRobotId={selectedRobotId}
              onRobotSelect={id => {
                const robot = id ? robots.find(ro => ro.id === id) ?? null : null;
                handleSelectRobot(robot);
              }}
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
