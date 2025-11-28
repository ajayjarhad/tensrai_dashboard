import { useEffect, useMemo, useState } from 'react';
import type { ProcessedMapData } from '@tensrai/shared';
import { apiClient } from '@/lib/api';
import type { Robot } from '../../../types/robot';
import { EmergencyHeader } from '../../emergency-stop/emergency-header';
import { useRobotTelemetry } from '@/hooks/useRobotTelemetry';
import { useRobots } from '../hooks/useRobots';
import { useRobotTelemetryStore } from '@/stores/robotTelemetry';
import { OccupancyMap } from './OccupancyMap';
import { Sidebar } from './Sidebar';
import type { MissionWithContext } from './MissionDialog';
import { toast } from 'sonner';
import { TeleopPanel } from './TeleopPanel';

export function Dashboard() {
  const { data: robots = [] } = useRobots();
  const [selectedRobotId, setSelectedRobotId] = useState<string | null>(null);
  const [activeMapId, setActiveMapId] = useState<string | null>(null);
  const [mapFeatures, setMapFeatures] = useState<ProcessedMapData['features'] | undefined>();
  const [allMissions, setAllMissions] = useState<MissionWithContext[]>([]);
  const activeRobotId = selectedRobotId ?? robots.find(robot => robot.mapId)?.id ?? null;
  const { telemetry, sendTeleop } = useRobotTelemetry(activeRobotId);
  const telemetryStore = useRobotTelemetryStore();

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isSettingPose, setIsSettingPose] = useState(false);
  const [teleopRobotId, setTeleopRobotId] = useState<string | null>(null);

  const robotsOnActiveMap = useMemo(
    () => robots.filter(r => !activeMapId || r.mapId === activeMapId),
    [robots, activeMapId]
  );

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

  // Load all missions across maps to show in sidebar with map and location context
  useEffect(() => {
    let cancelled = false;
    async function loadMissions() {
      try {
        const mapsRes = await apiClient.get<{ id: string; name: string }[]>('maps');
        const maps = mapsRes?.data ?? [];

        const missionEntries: Array<{
          id: string;
          name: string;
          steps: string[];
          mapId: string;
          mapName: string;
          locationTags: NonNullable<ProcessedMapData['features']>['locationTags'];
          availableRobots: Robot[];
        }> = [];

        for (const map of maps) {
          try {
            const mapDetail = await apiClient.get<{
              data?: { features?: ProcessedMapData['features'] };
            }>(`maps/${map.id}`);
            const features = mapDetail?.data?.features;
            if (features?.missions?.length) {
              const locationTags = features.locationTags ?? [];
              features.missions.forEach(mission => {
                missionEntries.push({
                  id: mission.id,
                  name: mission.name,
                  steps: Array.isArray(mission.steps) ? mission.steps : [],
                  mapId: map.id,
                  mapName: map.name,
                  locationTags,
                  availableRobots: [],
                });
              });
            }
          } catch (error) {
            console.error('Failed to load map missions', map.id, error);
          }
        }

        if (!cancelled) {
          setAllMissions(missionEntries);
        }
      } catch (error) {
        console.error('Failed to load missions', error);
      }
    }
    loadMissions();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelectRobot = (robot: Robot | null) => {
    setSelectedRobotId(robot?.id ?? null);
    if (robot?.mapId) {
      setActiveMapId(robot.mapId);
    }
    if (robot) {
      setIsSidebarOpen(true);
    }
  };

  const missionsWithRobots = useMemo(
    () =>
      allMissions.map(mission => ({
        ...mission,
        availableRobots: robots.filter(r => r.mapId === mission.mapId),
      })),
    [allMissions, robots]
  );

  const prioritizedMissions = useMemo(() => {
    const targetMap = activeMapId;
    const withPriority = missionsWithRobots.map(mission => {
      const hasRobots = (mission.availableRobots?.length ?? 0) > 0;
      const onTargetMap = targetMap && mission.mapId === targetMap;
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
  }, [activeMapId, missionsWithRobots]);

  const handleStartSetPose = () => {
    if (!activeMapId) {
      toast.error('Select a robot/map before setting pose');
      return;
    }
    setIsSettingPose(true);
    toast.message('Set pose: click a location tag or anywhere on the map. Press Esc to cancel.');
  };

  const handlePoseComplete = () => {
    setIsSettingPose(false);
  };

  const teleopRobot = teleopRobotId ? robots.find(r => r.id === teleopRobotId) ?? null : null;

  // Close teleop if the robot disappears or selection is cleared
  useEffect(() => {
    if (teleopRobotId && !robots.some(r => r.id === teleopRobotId)) {
      setTeleopRobotId(null);
    }
  }, [robots, teleopRobotId]);

  useEffect(() => {
    if (!selectedRobotId && teleopRobotId) {
      setTeleopRobotId(null);
    }
  }, [selectedRobotId, teleopRobotId]);

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden bg-background relative">
      <EmergencyHeader className="flex-shrink-0 z-20 relative" />
      <div className="flex flex-1 overflow-hidden relative w-full">
        <div className="flex-1 relative min-w-0">
          {activeMapId ? (
            <>
              <OccupancyMap
                mapId={activeMapId}
                onMapChange={setActiveMapId}
                width="100%"
                height="100%"
              enablePanning={true}
              enableZooming={true}
              robots={robotsOnActiveMap.map(robot => {
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
                const robot = id ? robotsOnActiveMap.find(ro => ro.id === id) ?? null : null;
                handleSelectRobot(robot);
              }}
                onMapFeaturesChange={setMapFeatures}
                setPoseMode={isSettingPose}
                onPoseConfirm={handlePoseComplete}
                onPoseCancel={handlePoseComplete}
              />

              {teleopRobot && teleopRobotId && (
                <TeleopPanel
                  robotId={teleopRobotId}
                  robotName={teleopRobot.name}
                  sendTeleop={sendTeleop}
                  onClose={() => setTeleopRobotId(null)}
                  className={isSidebarOpen ? 'right-2 md:right-4' : 'right-2'}
                />
              )}
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              {robots.length > 0 ? 'Select a robot to view map' : 'No robots available'}
            </div>
          )}
        </div>

        <Sidebar
          robots={robots}
          selectedRobotId={selectedRobotId}
          onSelectRobot={handleSelectRobot}
          isOpen={isSidebarOpen}
          onToggle={() => setIsSidebarOpen(!isSidebarOpen)}
          missions={prioritizedMissions}
          locationTags={mapFeatures?.locationTags}
          className="flex-shrink-0 border-l border-border bg-card z-10 shadow-xl"
          onManualControl={() => {
            if (!selectedRobotId) {
              toast.error('Select a robot to start teleop');
              return;
            }
            setTeleopRobotId(selectedRobotId);
            setIsSidebarOpen(true);
          }}
          onSetPose={() => {
            setIsSidebarOpen(true);
            handleStartSetPose();
          }}
        />
      </div>
    </div>
  );
}
