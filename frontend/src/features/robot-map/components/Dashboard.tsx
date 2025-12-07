import type { ProcessedMapData, ROSPoseWithCovarianceStamped } from '@tensrai/shared';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useRobotTelemetry } from '@/hooks/useRobotTelemetry';
import { worldToRosPose } from '@/lib/map/mapTransforms';
import { useRobotTelemetryStore } from '@/stores/robotTelemetry';
import { useMapRobots } from '../hooks/useMapRobots';
import { useRobotMissions } from '../hooks/useRobotMissions';
import { useRobotSelection } from '../hooks/useRobotSelection';
import { useRobots } from '../hooks/useRobots';
import { DashboardLayout } from './DashboardLayout';
import type { PoseConfirmPayload } from './Map/SetPoseLayer';
import { OccupancyMap } from './OccupancyMap';
import { Sidebar } from './Sidebar';
import { TeleopPanel } from './TeleopPanel';

export function Dashboard() {
  const { data: robots = [] } = useRobots();

  const {
    selectedRobotId,
    activeMapId,
    setActiveMapId,
    isSidebarOpen,
    setIsSidebarOpen,
    activeRobotId,
    handleSelectRobot,
  } = useRobotSelection(robots);

  const { missions: prioritizedMissions } = useRobotMissions(robots, activeMapId);
  const robotsOnActiveMap = useMapRobots(robots, activeMapId);

  const [_mapFeatures, setMapFeatures] = useState<ProcessedMapData['features'] | undefined>();
  const [isSettingPose, setIsSettingPose] = useState(false);
  const [teleopRobotId, setTeleopRobotId] = useState<string | null>(null);

  const { telemetry, sendTeleop, sendInitialPose } = useRobotTelemetry(activeRobotId);
  const telemetryStore = useRobotTelemetryStore();

  // Keep all robot telemetry sockets connected
  useEffect(() => {
    const ids = robots.map(r => r.id);
    ids.forEach(id => {
      telemetryStore.connect(id);
    });

    const currentIds = new Set(ids);
    Object.keys(telemetryStore.telemetry).forEach(id => {
      if (!currentIds.has(id)) {
        telemetryStore.disconnect(id);
      }
    });
  }, [robots, telemetryStore]);

  const handleStartSetPose = () => {
    if (!activeMapId) {
      toast.error('Select a robot/map before setting pose');
      return;
    }
    setIsSettingPose(true);
    toast.message('Set pose: click a location tag or anywhere on the map. Press Esc to cancel.');
  };

  const handlePoseConfirm = (payload: PoseConfirmPayload) => {
    if (!activeRobotId) {
      toast.error('Select a robot before setting pose');
      setIsSettingPose(false);
      return;
    }

    const rosPose = worldToRosPose({ x: payload.x, y: payload.y }, payload.theta);
    const covariance = Array(36).fill(0);
    covariance[0] = 0.25; // x variance (m^2)
    covariance[7] = 0.25; // y variance (m^2)
    covariance[35] = 0.068; // yaw variance (~15 deg^2)

    const message: ROSPoseWithCovarianceStamped = {
      header: {
        // Use stamp=0 so AMCL uses the latest TF available; include both ROS2 and ROS1 field names.
        stamp: { sec: 0, nanosec: 0, secs: 0, nsecs: 0 },
        frame_id: 'map',
      },
      pose: {
        pose: rosPose,
        covariance,
      },
    };

    sendInitialPose(activeRobotId, message);
    setIsSettingPose(false);
    toast.success('Pose command sent');
  };

  const handlePoseCancel = () => {
    setIsSettingPose(false);
  };

  const teleopRobot = teleopRobotId ? (robots.find(r => r.id === teleopRobotId) ?? null) : null;

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
    <DashboardLayout
      map={
        activeMapId ? (
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
              const robot = id ? (robotsOnActiveMap.find(ro => ro.id === id) ?? null) : null;
              handleSelectRobot(robot);
            }}
            onMapFeaturesChange={setMapFeatures}
            setPoseMode={isSettingPose}
            onPoseConfirm={handlePoseConfirm}
            onPoseCancel={handlePoseCancel}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            {robots.length > 0 ? 'Select a robot to view map' : 'No robots available'}
          </div>
        )
      }
      teleopPanel={
        teleopRobot && teleopRobotId ? (
          <TeleopPanel
            robotId={teleopRobotId}
            robotName={teleopRobot.name}
            sendTeleop={sendTeleop}
            onClose={() => setTeleopRobotId(null)}
            className={isSidebarOpen ? 'right-2 md:right-4' : 'right-2'}
          />
        ) : null
      }
      sidebar={
        <Sidebar
          robots={robots}
          selectedRobotId={selectedRobotId}
          onSelectRobot={handleSelectRobot}
          isOpen={isSidebarOpen}
          onToggle={() => setIsSidebarOpen(!isSidebarOpen)}
          missions={prioritizedMissions}
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
      }
    />
  );
}
