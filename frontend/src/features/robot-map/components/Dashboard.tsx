import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { mergeEmergencyRuntimeIntoRobot } from '@/lib/robotStatus';
import { useRobotEmergencyStore } from '@/stores/robotEmergency';
import { useRobotMissionStore } from '@/stores/robotMission';
import { useRobotTelemetryStore } from '@/stores/robotTelemetry';
import type { Robot } from '@/types/robot';
import { useClearPathOnMissionEnd } from '../hooks/useClearPathOnMissionEnd';
import { useEmergencyAlerts } from '../hooks/useEmergencyAlerts';
import { useMapAssetPrefetch } from '../hooks/useMapAssetPrefetch';
import { useMapRobots } from '../hooks/useMapRobots';
import { useMissionCommands } from '../hooks/useMissionCommands';
import { useMissionRuns } from '../hooks/useMissionRuns';
import { useMissionStartFlow } from '../hooks/useMissionStartFlow';
import { useMissionToasts } from '../hooks/useMissionToasts';
import { useRefetchOnEmergencyChange } from '../hooks/useRefetchOnEmergencyChange';
import { useRobotConnections } from '../hooks/useRobotConnections';
import { useRobotMissions } from '../hooks/useRobotMissions';
import { useRobotSelection } from '../hooks/useRobotSelection';
import { useRobots } from '../hooks/useRobots';
import { useSetPose } from '../hooks/useSetPose';
import { useTeleopControl } from '../hooks/useTeleopControl';
import type { FocusedMission } from '../types';
import { notifyFleetEmergencyResult, summarizeEmergency } from '../utils/fleetEmergency';
import { mergeMissionRuntimeIntoRobot } from '../utils/missionRuntime';
import { buildOngoingMissions, toMissionLogs } from '../utils/missionViews';
import { DashboardLayout } from './DashboardLayout';
import { EmergencyAlertDialog } from './EmergencyAlertDialog';
import { LiveOccupancyMap } from './LiveOccupancyMap';
import { MapSelector } from './MapSelector';
import { MissionDock } from './MissionDock/MissionDock';
import { Sidebar } from './Sidebar';
import { TeleopPanel } from './TeleopPanel';

// Hook order is effect order: several of these effects set the active map, and the last one wins.
export function Dashboard() {
  const { data: robotsData, refetch: refetchRobots } = useRobots();
  const { data: missionRunData } = useMissionRuns({ limit: 100 });
  const robotsFromApi = useMemo(() => robotsData ?? [], [robotsData]);
  const [focusedMission, setFocusedMission] = useState<FocusedMission | null>(null);

  const missionStatusByRobot = useRobotMissionStore(state => state.statusByRobot);
  const emergencyByRobot = useRobotEmergencyStore(state => state.byRobot);
  const syncEmergencyRobots = useRobotEmergencyStore(state => state.syncRobots);
  const sendFleetSoftwareEmergency = useRobotEmergencyStore(
    state => state.sendFleetSoftwareEmergency
  );
  const emergencyPendingDispatch = useRobotEmergencyStore(state => state.pendingDispatch);
  const hydrateMissionFromRobots = useRobotMissionStore(state => state.hydrateFromRobots);
  const sendTeleop = useRobotTelemetryStore(state => state.sendTeleop);

  const robots = useMemo(() => {
    const nowMs = Date.now();
    return robotsFromApi.map(robot =>
      mergeEmergencyRuntimeIntoRobot(
        mergeMissionRuntimeIntoRobot(robot, missionStatusByRobot[robot.id], nowMs),
        emergencyByRobot[robot.id]
      )
    );
  }, [emergencyByRobot, missionStatusByRobot, robotsFromApi]);

  useMapAssetPrefetch(robots);

  const {
    selectedRobotId,
    activeMapId,
    setActiveMapId,
    isSidebarOpen,
    setIsSidebarOpen,
    activeRobotId,
    handleSelectRobot,
  } = useRobotSelection(robots, { suspendAutoMapSync: Boolean(focusedMission) });

  const selectedRobot = robots.find(robot => robot.id === (selectedRobotId ?? '')) ?? null;

  const { missions: prioritizedMissions } = useRobotMissions(robots, activeMapId);
  const robotsOnActiveMap = useMapRobots(robots, activeMapId);

  const mapNameById = useMemo(() => {
    const map: Record<string, string> = {};
    prioritizedMissions.forEach(mission => {
      map[mission.mapId] = mission.mapName;
    });
    return map;
  }, [prioritizedMissions]);

  const robotsById = useMemo(() => {
    const map = new Map<string, Robot>();
    robots.forEach(robot => {
      map.set(robot.id, robot);
    });
    return map;
  }, [robots]);

  const missionLogs = useMemo(() => toMissionLogs(missionRunData), [missionRunData]);

  const emergencySummary = useMemo(() => summarizeEmergency(robots), [robots]);

  const hasReachableEmergencyRobot = emergencySummary.connectedRobots > 0;
  const canReleaseSoftwareEmergency = robots.some(
    robot =>
      robot.emergency?.connectionStatus === 'connected' && robot.emergency.softwareEmergencyActive
  );

  const resolveMissionContext = useCallback(
    (missionId?: string, mapId?: string) => {
      if (!missionId) return null;
      if (mapId) {
        const match = prioritizedMissions.find(m => m.id === missionId && m.mapId === mapId);
        if (match) return match;
      }
      return prioritizedMissions.find(m => m.id === missionId) ?? null;
    },
    [prioritizedMissions]
  );

  const focusedMissionContext = useMemo(() => {
    if (!focusedMission?.missionId) return null;
    return resolveMissionContext(focusedMission.missionId, focusedMission.mapId);
  }, [focusedMission, resolveMissionContext]);

  const highlightTagIds = focusedMissionContext?.steps ?? [];
  const dimNonMissionTags = Boolean(focusedMissionContext);

  useEffect(() => {
    hydrateMissionFromRobots(robotsFromApi);
  }, [hydrateMissionFromRobots, robotsFromApi]);

  useClearPathOnMissionEnd(missionStatusByRobot);

  useEffect(() => {
    syncEmergencyRobots(robotsFromApi);
  }, [robotsFromApi, syncEmergencyRobots]);

  useRefetchOnEmergencyChange(robots, refetchRobots);

  const { emergencyAlerts, acknowledgeEmergencyAlerts } = useEmergencyAlerts(robots, robotsFromApi);

  useRobotConnections(robots);

  const {
    isRobotEmergencyBlocked,
    dispatchMissionEvent,
    handlePauseMission,
    handleResumeMission,
    handleCancelMission,
    sendModeChange,
  } = useMissionCommands(robotsById, missionStatusByRobot);

  const {
    pendingMissionStarts,
    startRobotId,
    startMissionId,
    setStartMissionId,
    pendingMissionStart,
    pendingMissionPhase,
    pendingMissionMessage,
    handleShowUpForRobot,
    handleConfirmMissionStart,
    handleCancelMissionStart,
    handleFocusMission,
    handleClearMissionFocus,
    handleSidebarRobotSelect,
    selectStartRobot,
  } = useMissionStartFlow({
    robots,
    prioritizedMissions,
    missionStatusByRobot,
    resolveMissionContext,
    selectedRobotId,
    activeMapId,
    setActiveMapId,
    handleSelectRobot,
    focusedMission,
    setFocusedMission,
    dispatchMissionEvent,
    isRobotEmergencyBlocked,
  });

  useMissionToasts(robots, missionStatusByRobot, resolveMissionContext);

  const { isSettingPose, handleStartSetPose, handlePoseConfirm, handlePoseCancel } = useSetPose(
    selectedRobotId,
    selectedRobot
  );

  const handleFleetEmergencyDispatch = useCallback(
    async (desiredStatus: boolean) => {
      const result = await sendFleetSoftwareEmergency(desiredStatus);
      notifyFleetEmergencyResult(desiredStatus, result);
    },
    [sendFleetSoftwareEmergency]
  );

  const { teleopRobot, closeTeleop, enableManualControl } = useTeleopControl({
    robots,
    selectedRobotId,
    missionStatusByRobot,
    sendModeChange,
    setIsSidebarOpen,
  });

  const ongoingMissions = useMemo(
    () =>
      buildOngoingMissions({
        robots,
        missionStatusByRobot,
        pendingMissionStarts,
        resolveMissionContext,
        mapNameById,
        selectedRobotId,
      }),
    [
      mapNameById,
      missionStatusByRobot,
      pendingMissionStarts,
      resolveMissionContext,
      robots,
      selectedRobotId,
    ]
  );

  return (
    <>
      <DashboardLayout
        emergencyHeader={{
          summary: emergencySummary,
          pendingDesiredStatus: emergencyPendingDispatch?.desiredStatus ?? null,
          canSendEmergency: hasReachableEmergencyRobot,
          canReleaseSoftware: canReleaseSoftwareEmergency,
          onEmergencyAll: () => {
            void handleFleetEmergencyDispatch(true);
          },
          onReleaseSoftware: () => {
            void handleFleetEmergencyDispatch(false);
          },
        }}
        map={
          activeMapId ? (
            <div className="relative h-full w-full">
              <MapSelector
                robot={selectedRobot}
                activeMapId={activeMapId}
                onActiveMapChange={setActiveMapId}
                onRefresh={() => {
                  void refetchRobots();
                }}
              />
              <LiveOccupancyMap
                mapId={activeMapId}
                onMapChange={mapId => {
                  if (focusedMission) return;
                  setActiveMapId(mapId);
                }}
                robots={robotsOnActiveMap}
                telemetryRobotId={activeRobotId}
                selectedRobotId={selectedRobotId}
                onRobotSelect={id => {
                  const robot = id ? (robotsOnActiveMap.find(ro => ro.id === id) ?? null) : null;
                  handleSidebarRobotSelect(robot);
                }}
                setPoseMode={isSettingPose}
                onPoseConfirm={handlePoseConfirm}
                onPoseCancel={handlePoseCancel}
                highlightTagIds={highlightTagIds}
                dimNonMissionTags={dimNonMissionTags}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              {robots.length > 0 ? 'Select a robot to view map' : 'No robots available'}
            </div>
          )
        }
        missionDock={
          <MissionDock
            robots={robots}
            missions={prioritizedMissions}
            ongoingMissions={ongoingMissions}
            missionLogs={missionLogs}
            focusedMission={
              focusedMission
                ? {
                    robotId: focusedMission.robotId,
                    ...(focusedMission.missionId ? { missionId: focusedMission.missionId } : {}),
                  }
                : null
            }
            selectedRobotId={selectedRobotId}
            startRobotId={startRobotId}
            startMissionId={startMissionId}
            pendingStart={pendingMissionStart}
            pendingPhase={pendingMissionPhase}
            pendingMessage={pendingMissionMessage}
            onSetStartRobot={selectStartRobot}
            onSetStartMission={missionId => setStartMissionId(missionId)}
            onShowUp={handleShowUpForRobot}
            onConfirmStart={handleConfirmMissionStart}
            onCancelStart={handleCancelMissionStart}
            onFocusMission={handleFocusMission}
            onClearFocus={handleClearMissionFocus}
            onPauseMission={handlePauseMission}
            onResumeMission={handleResumeMission}
            onCancelMission={handleCancelMission}
          />
        }
        teleopPanel={
          teleopRobot ? (
            <TeleopPanel
              robotId={teleopRobot.id}
              robotName={teleopRobot.name}
              sendTeleop={sendTeleop}
              onClose={closeTeleop}
              className={isSidebarOpen ? 'right-2 md:right-4 bottom-28' : 'right-2 bottom-28'}
            />
          ) : null
        }
        sidebar={
          <Sidebar
            robots={robots}
            selectedRobotId={selectedRobotId}
            onSelectRobot={handleSidebarRobotSelect}
            isOpen={isSidebarOpen}
            onToggle={() => setIsSidebarOpen(!isSidebarOpen)}
            mapNameById={mapNameById}
            className="flex-shrink-0 border-l border-border bg-card z-10 shadow-xl"
            onManualControl={() => {
              if (!selectedRobotId) {
                toast.error('Select a robot to start teleop');
                return;
              }
              enableManualControl(selectedRobotId);
            }}
            onSetPose={() => {
              setIsSidebarOpen(true);
              handleStartSetPose();
            }}
          />
        }
      />

      <EmergencyAlertDialog alerts={emergencyAlerts} onAcknowledge={acknowledgeEmergencyAlerts} />
    </>
  );
}
