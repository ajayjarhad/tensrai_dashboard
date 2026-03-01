import type { ProcessedMapData, ROSPoseWithCovarianceStamped } from '@tensrai/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useRobotTelemetry } from '@/hooks/useRobotTelemetry';
import { worldToRosPose } from '@/lib/map/mapTransforms';
import { mergeEmergencyRuntimeIntoRobot } from '@/lib/robotStatus';
import { useRobotEmergencyStore } from '@/stores/robotEmergency';
import { type MissionStatus, useRobotMissionStore } from '@/stores/robotMission';
import { type Robot, RobotMode } from '@/types/robot';
import { useMapRobots } from '../hooks/useMapRobots';
import { useRobotMissions } from '../hooks/useRobotMissions';
import { useRobotSelection } from '../hooks/useRobotSelection';
import { useRobots } from '../hooks/useRobots';
import { DashboardLayout } from './DashboardLayout';
import type { PoseConfirmPayload } from './Map/SetPoseLayer';
import type { MissionWithContext } from './MissionDialog';
import {
  MissionDock,
  type MissionLogView,
  type OngoingMissionView,
} from './MissionDock/MissionDock';
import { OccupancyMap } from './OccupancyMap';
import { Sidebar } from './Sidebar';
import { TeleopPanel } from './TeleopPanel';

const MISSION_STALE_MS = 120_000;

const missionTimestamp = (status?: MissionStatus) => status?.lastSeenTs ?? status?.updatedAt;

const missionIsFresh = (status?: MissionStatus, nowMs = Date.now()) => {
  const ts = missionTimestamp(status);
  if (!Number.isFinite(ts)) return false;
  return nowMs - (ts as number) <= MISSION_STALE_MS;
};

const missionIsLive = (status?: MissionStatus, nowMs = Date.now()) =>
  missionIsFresh(status, nowMs) &&
  (status?.status === 'running' || status?.status === 'paused' || status?.status === 'showing');

const isMissionActiveStatus = (status?: MissionStatus['status']) =>
  status === 'running' || status === 'paused' || status === 'showing';

const resolveRuntimeStatus = (
  robot: Robot,
  mission: MissionStatus | undefined,
  nowMs: number
): RobotMode => {
  if (!mission) return robot.status;
  if (!missionIsFresh(mission, nowMs)) return robot.status;
  if (missionIsLive(mission, nowMs)) return RobotMode.MISSION;
  if (mission.mode === 'teleop') return RobotMode.TELEOP;
  if (mission.mode === 'autonomous' && robot.status === RobotMode.TELEOP) {
    return RobotMode.UNKNOWN;
  }
  return robot.status;
};

const mergeMissionRuntimeIntoRobot = (
  robot: Robot,
  mission: MissionStatus | undefined,
  nowMs: number
): Robot => {
  if (!mission) return robot;

  const liveBattery =
    typeof mission.batteryPercentage === 'number' && Number.isFinite(mission.batteryPercentage)
      ? mission.batteryPercentage
      : mission.batteryPercentage === null
        ? undefined
        : robot.battery;

  const lastSeenIso = mission.lastSeenTs
    ? new Date(mission.lastSeenTs).toISOString()
    : robot.lastSeen;
  const isFresh = missionIsFresh(mission, nowMs);
  const isLive = missionIsLive(mission, nowMs);

  const merged: Robot = {
    ...robot,
    status: resolveRuntimeStatus(robot, mission, nowMs),
    lastSeen: lastSeenIso,
  };

  if (isFresh && liveBattery !== undefined) merged.battery = liveBattery;
  if (isFresh && mission.mode !== undefined) merged.runtimeMode = mission.mode;
  if (isFresh && mission.batteryPercentage !== undefined) {
    merged.runtimeBatteryPercentage = mission.batteryPercentage;
  }
  if (isFresh && mission.chargingStatus !== undefined) {
    merged.runtimeChargingStatus = mission.chargingStatus;
  }
  if (isFresh && mission.lastSeenTs !== undefined) merged.runtimeLastSeenTs = mission.lastSeenTs;
  if (isLive && mission.waypointIndex !== undefined) merged.waypointIndex = mission.waypointIndex;
  if (isLive && mission.totalWaypoints !== undefined)
    merged.totalWaypoints = mission.totalWaypoints;

  return merged;
};

type FocusedMission = {
  robotId: string;
  missionId?: string;
  mapId: string;
};

type PendingMissionStart = {
  robotId: string;
  mission: MissionWithContext;
};

type MissionClock = {
  missionId?: string;
  startedAt: number;
};

type EmergencyAlert = {
  id: string;
  robotId: string;
  robotName: string;
  kind: 'software' | 'hardware';
};

const resolveMissionSortRank = (status: OngoingMissionView['status']) => {
  if (status === 'running') return 0;
  if (status === 'paused') return 1;
  return 2;
};

const normalizeMissionResult = (status?: MissionStatus): MissionLogView['result'] | null => {
  if (!status) return null;
  if (status.lastEvent !== 'MISSION_COMPLETED') return null;
  if (status.lastEventStatus === 'cancelled' || status.status === 'cancelled') return null;
  if (status.lastEventStatus === 'success' || status.status === 'completed') return 'completed';
  return 'failed';
};

export function Dashboard() {
  const { data: robotsData } = useRobots();
  const robotsFromApi = useMemo(() => robotsData ?? [], [robotsData]);
  const [pendingMissionStart, setPendingMissionStart] = useState<PendingMissionStart | null>(null);
  const [focusedMission, setFocusedMission] = useState<FocusedMission | null>(null);
  const [startRobotId, setStartRobotId] = useState<string | null>(null);
  const [startMissionId, setStartMissionId] = useState<string | null>(null);
  const [missionClocks, setMissionClocks] = useState<Record<string, MissionClock>>({});
  const [missionLogs, setMissionLogs] = useState<MissionLogView[]>([]);
  const [emergencyAlerts, setEmergencyAlerts] = useState<EmergencyAlert[]>([]);

  const missionStatusByRobot = useRobotMissionStore(state => state.statusByRobot);
  const emergencyByRobot = useRobotEmergencyStore(state => state.byRobot);
  const syncEmergencyRobots = useRobotEmergencyStore(state => state.syncRobots);
  const disconnectEmergencyRobots = useRobotEmergencyStore(state => state.disconnectAll);
  const sendFleetSoftwareEmergency = useRobotEmergencyStore(
    state => state.sendFleetSoftwareEmergency
  );
  const emergencyPendingDispatch = useRobotEmergencyStore(state => state.pendingDispatch);
  const connectMission = useRobotMissionStore(state => state.connect);
  const disconnectMission = useRobotMissionStore(state => state.disconnect);
  const sendMissionEvent = useRobotMissionStore(state => state.sendEvent);
  const hydrateMissionFromRobots = useRobotMissionStore(state => state.hydrateFromRobots);
  const missionConnectionsRef = useRef<Set<string>>(new Set());
  const loggedResultKeysRef = useRef<Set<string>>(new Set());
  const lastMissionToastRef = useRef<Record<string, number>>({});
  const lastEmergencyAckAtRef = useRef<Record<string, number>>({});
  const hasShownInitialEmergencyPopupRef = useRef<Record<string, boolean>>({});

  const robots = useMemo(() => {
    const nowMs = Date.now();
    return robotsFromApi.map(robot =>
      mergeEmergencyRuntimeIntoRobot(
        mergeMissionRuntimeIntoRobot(robot, missionStatusByRobot[robot.id], nowMs),
        emergencyByRobot[robot.id]
      )
    );
  }, [emergencyByRobot, missionStatusByRobot, robotsFromApi]);

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

  const [_mapFeatures, setMapFeatures] = useState<ProcessedMapData['features'] | undefined>();
  const [isSettingPose, setIsSettingPose] = useState(false);
  const [teleopRobotId, setTeleopRobotId] = useState<string | null>(null);

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

  const emergencySummary = useMemo(() => {
    let connectedRobots = 0;
    let softwareEmergencyCount = 0;
    let hardwareEmergencyCount = 0;
    let unknownCount = 0;
    let anyEmergencyActive = false;

    for (const robot of robots) {
      const state = robot.emergency;
      if (state?.effectiveEmergencyActive) {
        anyEmergencyActive = true;
      }
      if (!robot.ipAddress || !state || state.connectionStatus !== 'connected') {
        unknownCount += 1;
        continue;
      }

      connectedRobots += 1;
      if (state.hardwareEmergencyActive) {
        hardwareEmergencyCount += 1;
      } else if (state.softwareEmergencyActive) {
        softwareEmergencyCount += 1;
      }
    }

    return {
      totalRobots: robots.length,
      connectedRobots,
      softwareEmergencyCount,
      hardwareEmergencyCount,
      unknownCount,
      anyEmergencyActive,
    };
  }, [robots]);

  const hasReachableEmergencyRobot = emergencySummary.connectedRobots > 0;
  const canReleaseSoftwareEmergency = robots.some(
    robot =>
      robot.emergency?.connectionStatus === 'connected' && robot.emergency.softwareEmergencyActive
  );
  const currentEmergencyAlert = emergencyAlerts[0] ?? null;

  const isRobotEmergencyBlocked = useCallback(
    (robotId: string) => {
      return Boolean(robotsById.get(robotId)?.emergency?.effectiveEmergencyActive);
    },
    [robotsById]
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

  const { telemetry, sendTeleop, sendInitialPose } = useRobotTelemetry(activeRobotId);

  useEffect(() => {
    hydrateMissionFromRobots(robotsFromApi);
  }, [hydrateMissionFromRobots, robotsFromApi]);

  useEffect(() => {
    syncEmergencyRobots(robotsFromApi);
  }, [robotsFromApi, syncEmergencyRobots]);

  useEffect(() => {
    for (const robot of robots) {
      const eventType = robot.emergency?.lastEventType;
      const eventAt = robot.emergency?.lastEventAt;
      const active = Boolean(robot.emergency?.effectiveEmergencyActive);
      const canShowInitialSnapshot =
        active &&
        eventType === 'EMERGENCY_STATE' &&
        !hasShownInitialEmergencyPopupRef.current[robot.id];
      const canShowAckPopup =
        active &&
        !!eventAt &&
        (eventType === 'SOFTWARE_EMERGENCY_ACK' || eventType === 'HARDWARE_EMERGENCY_ACK') &&
        (lastEmergencyAckAtRef.current[robot.id] ?? 0) < eventAt;

      if (!active) {
        delete hasShownInitialEmergencyPopupRef.current[robot.id];
        continue;
      }

      if (!canShowInitialSnapshot && !canShowAckPopup) {
        continue;
      }

      if (canShowInitialSnapshot) {
        hasShownInitialEmergencyPopupRef.current[robot.id] = true;
      }
      if (canShowAckPopup && eventAt) {
        lastEmergencyAckAtRef.current[robot.id] = eventAt;
      }

      setEmergencyAlerts(current => {
        const alertId = canShowAckPopup
          ? `ack:${robot.id}:${eventType}:${eventAt}`
          : `snapshot:${robot.id}:${robot.emergency?.hardwareEmergencyActive ? 'hardware' : 'software'}`;
        if (current.some(alert => alert.id === alertId)) return current;
        return [
          ...current,
          {
            id: alertId,
            robotId: robot.id,
            robotName: robot.name,
            kind: robot.emergency?.hardwareEmergencyActive ? 'hardware' : 'software',
          },
        ];
      });
    }
  }, [robots]);

  useEffect(() => {
    const nextIds = new Set(robots.map(robot => robot.id));

    nextIds.forEach(id => {
      if (missionConnectionsRef.current.has(id)) return;
      connectMission(id);
      missionConnectionsRef.current.add(id);
    });

    for (const id of Array.from(missionConnectionsRef.current)) {
      if (nextIds.has(id)) continue;
      disconnectMission(id);
      missionConnectionsRef.current.delete(id);
    }
  }, [connectMission, disconnectMission, robots]);

  useEffect(
    () => () => {
      for (const id of Array.from(missionConnectionsRef.current)) {
        disconnectMission(id);
      }
      missionConnectionsRef.current.clear();
      disconnectEmergencyRobots();
    },
    [disconnectEmergencyRobots, disconnectMission]
  );

  useEffect(() => {
    if (!focusedMission?.mapId) return;
    if (activeMapId !== focusedMission.mapId) {
      setActiveMapId(focusedMission.mapId);
    }
  }, [activeMapId, focusedMission, setActiveMapId]);

  useEffect(() => {
    if (!startRobotId) {
      setStartMissionId(null);
      return;
    }
    const robot = robots.find(item => item.id === startRobotId);
    if (!robot) {
      setStartMissionId(null);
      return;
    }
    if (robot.mapId && activeMapId !== robot.mapId) {
      setActiveMapId(robot.mapId);
    }
    if (!startMissionId) return;
    const mission = prioritizedMissions.find(
      m => m.id === startMissionId && m.mapId === robot.mapId
    );
    if (!mission) {
      setStartMissionId(null);
    }
  }, [activeMapId, prioritizedMissions, robots, setActiveMapId, startMissionId, startRobotId]);

  useEffect(() => {
    if (!startRobotId || !startMissionId) return;
    const robot = robots.find(item => item.id === startRobotId);
    if (!robot?.mapId) return;
    const mission = prioritizedMissions.find(
      m => m.id === startMissionId && m.mapId === robot.mapId
    );
    if (!mission) return;
    setFocusedMission(current => {
      if (
        current?.robotId === startRobotId &&
        current.missionId === startMissionId &&
        current.mapId === mission.mapId
      ) {
        return current;
      }
      return {
        robotId: startRobotId,
        missionId: startMissionId,
        mapId: mission.mapId,
      };
    });
    if (activeMapId !== mission.mapId) {
      setActiveMapId(mission.mapId);
    }
  }, [activeMapId, prioritizedMissions, robots, setActiveMapId, startMissionId, startRobotId]);

  useEffect(() => {
    setMissionClocks(prev => {
      let changed = false;
      const next = { ...prev };

      for (const robot of robots) {
        const robotId = robot.id;
        const status = missionStatusByRobot[robotId];
        if (!status) continue;

        const missionId = status.currentMissionId ?? status.lastEventMissionId;
        const active = isMissionActiveStatus(status.status);
        const existing = next[robotId];

        if (active) {
          if (!missionId) continue;
          if (!existing || existing.missionId !== missionId) {
            next[robotId] = {
              missionId,
              startedAt: status.lastEventAt ?? status.updatedAt ?? Date.now(),
            };
            changed = true;
          }
          continue;
        }

        if (existing && (!missionId || existing.missionId === missionId)) {
          delete next[robotId];
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [missionStatusByRobot, robots]);

  useEffect(() => {
    const nextLogs: MissionLogView[] = [];

    for (const robot of robots) {
      const status = missionStatusByRobot[robot.id];
      if (!status?.lastEventAt) continue;

      const result = normalizeMissionResult(status);
      if (!result) continue;

      const missionId = status.currentMissionId ?? status.lastEventMissionId;
      const logKey = `${robot.id}:${missionId ?? 'unknown'}:${status.lastEventAt}:${result}`;
      if (loggedResultKeysRef.current.has(logKey)) continue;
      loggedResultKeysRef.current.add(logKey);

      const missionContext = resolveMissionContext(missionId, robot.mapId);
      const startedAt =
        missionId && missionClocks[robot.id]?.missionId === missionId
          ? missionClocks[robot.id]?.startedAt
          : undefined;

      nextLogs.push({
        id: logKey,
        robotId: robot.id,
        robotName: robot.name,
        ...(missionId ? { missionId } : {}),
        missionName: missionContext?.name ?? `Mission ${missionId ?? ''}`.trim(),
        result,
        ...(startedAt ? { startedAt } : {}),
        endedAt: status.lastEventAt,
        ...(startedAt && status.lastEventAt >= startedAt
          ? { durationMs: status.lastEventAt - startedAt }
          : {}),
        ...(status.waypointIndex !== undefined ? { waypointIndex: status.waypointIndex } : {}),
        ...(status.totalWaypoints !== undefined ? { totalWaypoints: status.totalWaypoints } : {}),
        ...(status.message ? { message: status.message } : {}),
      });
    }

    if (!nextLogs.length) return;
    setMissionLogs(current => [...nextLogs.reverse(), ...current].slice(0, 100));
  }, [missionClocks, missionStatusByRobot, resolveMissionContext, robots]);

  useEffect(() => {
    if (!activeRobotId) return;
    const status = missionStatusByRobot[activeRobotId];
    if (!status?.lastEvent || !status.lastEventAt) return;

    const lastSeen = lastMissionToastRef.current[activeRobotId] ?? 0;
    if (status.lastEventAt <= lastSeen) return;
    lastMissionToastRef.current[activeRobotId] = status.lastEventAt;

    const missionId = status.lastEventMissionId ?? status.currentMissionId;
    const missionName = missionId
      ? (resolveMissionContext(missionId, selectedRobot?.mapId)?.name ?? `Mission ${missionId}`)
      : 'Mission';

    if (status.lastEvent === 'MISSION_START_ACK') {
      if (status.lastEventStatus === 'success') {
        toast.success(`${missionName} started`);
      } else {
        toast.error(status.message ?? `${missionName} failed to start`);
      }
      return;
    }

    if (status.lastEvent === 'MISSION_CONTROL_ACK') {
      const requestType = status.lastRequestType ?? 'UNKNOWN';
      if (status.lastEventStatus === 'success') {
        if (requestType === 'SHOW_UP') toast.success(`${missionName} ready to start`);
        if (requestType === 'PAUSE') toast.message(`${missionName} paused`);
        if (requestType === 'RESUME') toast.success(`${missionName} resumed`);
        if (requestType === 'CANCEL') toast.message(`${missionName} cancelled`);
      } else {
        toast.error(status.message ?? `${missionName} control failed`);
      }
      return;
    }

    if (status.lastEvent === 'MISSION_COMPLETED') {
      if (status.lastEventStatus === 'success') {
        toast.success(`${missionName} completed`);
      } else if (status.lastEventStatus === 'cancelled') {
        toast.message(`${missionName} cancelled`);
      } else {
        toast.error(`${missionName} failed`);
      }
      return;
    }

    if (status.lastEvent === 'MODE_CHANGE_ACK') {
      if (status.lastEventStatus === 'success') {
        toast.message(
          status.mode ? `Robot mode changed to ${status.mode}` : 'Robot mode changed successfully'
        );
      } else {
        toast.error(status.message ?? 'Mode change failed');
      }
      return;
    }

    if (status.lastEvent === 'WAYPOINT_ACK') {
      if (status.waypointIndex && status.totalWaypoints) {
        toast.message(`${missionName}: waypoint ${status.waypointIndex}/${status.totalWaypoints}`);
      } else {
        toast.message(status.message ?? `${missionName}: waypoint reached`);
      }
    }
  }, [activeRobotId, missionStatusByRobot, resolveMissionContext, selectedRobot?.mapId]);

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
    covariance[0] = 0.25;
    covariance[7] = 0.25;
    covariance[35] = 0.068;

    const message: ROSPoseWithCovarianceStamped = {
      header: {
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

  const resolveMissionForRobot = useCallback(
    (robotId: string, missionId: string) => {
      const robot = robots.find(item => item.id === robotId);
      if (!robot?.mapId) return null;
      return prioritizedMissions.find(m => m.id === missionId && m.mapId === robot.mapId) ?? null;
    },
    [prioritizedMissions, robots]
  );

  const dispatchMissionEvent = useCallback(
    (
      robotId: string,
      event: string,
      payload: Record<string, unknown>,
      options?: { queuedMessage?: string; errorMessage?: string }
    ) => {
      const result = sendMissionEvent(robotId, event, payload);
      if (!result.accepted) {
        toast.error(options?.errorMessage ?? 'Failed to send mission command');
        return false;
      }
      if (result.queued) {
        toast.message(
          options?.queuedMessage ?? 'Robot mission socket is reconnecting. Command queued.'
        );
      }
      return true;
    },
    [sendMissionEvent]
  );

  const handleFleetEmergencyDispatch = useCallback(
    async (desiredStatus: boolean) => {
      const result = await sendFleetSoftwareEmergency(desiredStatus);
      const successCount = result.results.filter(entry => entry.applied).length;
      const failureCount = result.results.length - successCount;
      const failureSummary = result.results
        .filter(entry => !entry.applied)
        .map(entry => `${entry.robotName ?? entry.robotId}: ${entry.error ?? 'unknown error'}`)
        .join('; ');
      const hardwareLockedCount = result.results.filter(
        entry => entry.applied && entry.hardwareEmergencyActive
      ).length;

      if (desiredStatus) {
        if (result.status === 'success') {
          toast.success(`Emergency sent to ${successCount} robot${successCount === 1 ? '' : 's'}`);
        } else if (result.status === 'partial_failure') {
          toast.error(`Emergency sent to ${successCount} robots, ${failureCount} failed`, {
            description: failureSummary || undefined,
          });
        } else {
          toast.error('Emergency command failed for all robots', {
            description: failureSummary || undefined,
          });
        }
        return;
      }

      if (result.status === 'failure') {
        toast.error('Release command failed for all robots', {
          description: failureSummary || undefined,
        });
        return;
      }

      if (hardwareLockedCount > 0) {
        toast.message(
          `Software emergency released; ${hardwareLockedCount} robot${
            hardwareLockedCount === 1 ? '' : 's'
          } remain stopped due to hardware emergency`
        );
        return;
      }

      if (result.status === 'partial_failure') {
        toast.error(`Release sent to ${successCount} robots, ${failureCount} failed`, {
          description: failureSummary || undefined,
        });
        return;
      }

      toast.success(`Release sent to ${successCount} robot${successCount === 1 ? '' : 's'}`);
    },
    [sendFleetSoftwareEmergency]
  );

  const handleShowUpForRobot = useCallback(
    (robotId: string, missionId: string) => {
      if (isRobotEmergencyBlocked(robotId)) {
        toast.error('Controls unavailable while emergency stop is active');
        return;
      }
      const mission = resolveMissionForRobot(robotId, missionId);
      if (!mission) {
        toast.error('Mission does not belong to selected robot map');
        return;
      }
      const dispatched = dispatchMissionEvent(
        robotId,
        'SHOW_UP',
        { missionId: mission.id },
        {
          queuedMessage: `SHOW_UP queued for ${mission.name}`,
          errorMessage: 'Unable to send SHOW_UP command',
        }
      );
      if (!dispatched) return;
      setPendingMissionStart({ robotId, mission });
      setFocusedMission({ robotId, missionId: mission.id, mapId: mission.mapId });
      setStartRobotId(robotId);
      setStartMissionId(mission.id);
      setActiveMapId(mission.mapId);
      const robot = robots.find(item => item.id === robotId) ?? null;
      if (robot) handleSelectRobot(robot);
    },
    [
      dispatchMissionEvent,
      handleSelectRobot,
      isRobotEmergencyBlocked,
      resolveMissionForRobot,
      robots,
      setActiveMapId,
    ]
  );

  const handleConfirmMissionStart = useCallback(() => {
    if (!pendingMissionStart) return;
    if (isRobotEmergencyBlocked(pendingMissionStart.robotId)) {
      toast.error('Controls unavailable while emergency stop is active');
      return;
    }
    const dispatched = dispatchMissionEvent(
      pendingMissionStart.robotId,
      'START_MISSION',
      {
        missionId: pendingMissionStart.mission.id,
      },
      {
        queuedMessage: `START_MISSION queued for ${pendingMissionStart.mission.name}`,
        errorMessage: 'Unable to send START_MISSION command',
      }
    );
    if (!dispatched) return;
    setPendingMissionStart(null);
  }, [dispatchMissionEvent, isRobotEmergencyBlocked, pendingMissionStart]);

  const handleCancelMissionStart = useCallback(() => {
    setPendingMissionStart(null);
    setFocusedMission(null);
  }, []);

  const resolveMissionIdForRobot = useCallback(
    (robotId: string, missionId?: string) => {
      if (missionId) return missionId;
      const status = missionStatusByRobot[robotId];
      return status?.currentMissionId;
    },
    [missionStatusByRobot]
  );

  const handlePauseMission = useCallback(
    (robotId: string, missionId?: string) => {
      if (isRobotEmergencyBlocked(robotId)) {
        toast.error('Controls unavailable while emergency stop is active');
        return;
      }
      const resolvedId = resolveMissionIdForRobot(robotId, missionId);
      if (!resolvedId) {
        toast.error('No active mission to pause');
        return;
      }
      dispatchMissionEvent(
        robotId,
        'PAUSE_MISSION',
        { missionId: resolvedId },
        { queuedMessage: 'Pause command queued', errorMessage: 'Unable to send pause command' }
      );
    },
    [dispatchMissionEvent, isRobotEmergencyBlocked, resolveMissionIdForRobot]
  );

  const handleResumeMission = useCallback(
    (robotId: string, missionId?: string) => {
      if (isRobotEmergencyBlocked(robotId)) {
        toast.error('Controls unavailable while emergency stop is active');
        return;
      }
      const resolvedId = resolveMissionIdForRobot(robotId, missionId);
      if (!resolvedId) {
        toast.error('No paused mission to resume');
        return;
      }
      dispatchMissionEvent(
        robotId,
        'RESUME_MISSION',
        { missionId: resolvedId },
        { queuedMessage: 'Resume command queued', errorMessage: 'Unable to send resume command' }
      );
    },
    [dispatchMissionEvent, isRobotEmergencyBlocked, resolveMissionIdForRobot]
  );

  const handleCancelMission = useCallback(
    (robotId: string, missionId?: string) => {
      if (isRobotEmergencyBlocked(robotId)) {
        toast.error('Controls unavailable while emergency stop is active');
        return;
      }
      const resolvedId = resolveMissionIdForRobot(robotId, missionId);
      if (!resolvedId) {
        toast.error('No mission to cancel');
        return;
      }
      dispatchMissionEvent(
        robotId,
        'CANCEL_MISSION',
        { missionId: resolvedId },
        { queuedMessage: 'Cancel command queued', errorMessage: 'Unable to send cancel command' }
      );
    },
    [dispatchMissionEvent, isRobotEmergencyBlocked, resolveMissionIdForRobot]
  );

  const sendModeChange = useCallback(
    (robotId: string, targetMode: 'teleopActive' | 'autonomousActive') => {
      dispatchMissionEvent(
        robotId,
        'CHANGE_MODE',
        { targetMode },
        { queuedMessage: 'Mode change command queued', errorMessage: 'Unable to change mode' }
      );
    },
    [dispatchMissionEvent]
  );

  const enableManualControl = useCallback(
    (robotId: string) => {
      if (!robotId) return;
      if (teleopRobotId && teleopRobotId !== robotId) {
        sendModeChange(teleopRobotId, 'autonomousActive');
      }
      if (teleopRobotId !== robotId) {
        sendModeChange(robotId, 'teleopActive');
      }
      setTeleopRobotId(robotId);
      setIsSidebarOpen(true);
    },
    [sendModeChange, setIsSidebarOpen, teleopRobotId]
  );

  const disableManualControl = useCallback(
    (robotId?: string | null) => {
      const targetId = robotId ?? teleopRobotId;
      if (!targetId) return;
      sendModeChange(targetId, 'autonomousActive');
      setTeleopRobotId(current => (current === targetId ? null : current));
    },
    [sendModeChange, teleopRobotId]
  );

  const teleopRobot = teleopRobotId ? (robots.find(r => r.id === teleopRobotId) ?? null) : null;

  useEffect(() => {
    if (teleopRobotId && !robots.some(r => r.id === teleopRobotId)) {
      setTeleopRobotId(null);
    }
  }, [robots, teleopRobotId]);

  useEffect(() => {
    if (!selectedRobotId && teleopRobotId) {
      disableManualControl(teleopRobotId);
    }
  }, [disableManualControl, selectedRobotId, teleopRobotId]);

  const handleFocusMission = useCallback(
    (robotId: string, missionId?: string) => {
      const robot = robots.find(item => item.id === robotId) ?? null;
      if (robot) {
        handleSelectRobot(robot);
      }
      const mission = resolveMissionContext(missionId, robot?.mapId);
      const mapId = mission?.mapId ?? robot?.mapId;
      if (!mapId) {
        toast.error('Unable to resolve mission map');
        return;
      }
      setFocusedMission({
        robotId,
        mapId,
        ...(missionId ? { missionId } : {}),
      });
      setActiveMapId(mapId);
      if (missionId) {
        setStartRobotId(robotId);
        setStartMissionId(missionId);
      }
    },
    [handleSelectRobot, resolveMissionContext, robots, setActiveMapId]
  );

  const handleClearMissionFocus = useCallback(() => {
    setFocusedMission(null);
  }, []);

  const ongoingMissions = useMemo<OngoingMissionView[]>(() => {
    const nowMs = Date.now();
    const rows: OngoingMissionView[] = [];

    for (const robot of robots) {
      const status = missionStatusByRobot[robot.id];
      if (!status || !isMissionActiveStatus(status.status)) continue;
      if (!missionIsFresh(status, nowMs)) continue;
      const missionId = status.currentMissionId ?? status.lastEventMissionId;
      const mission = resolveMissionContext(missionId, robot.mapId);
      const started = missionClocks[robot.id];
      const startedAt =
        started && (!missionId || !started.missionId || started.missionId === missionId)
          ? started.startedAt
          : undefined;
      const rowMapId = mission?.mapId ?? robot.mapId;
      const rowMapName = mission?.mapName ?? (robot.mapId ? mapNameById[robot.mapId] : undefined);

      rows.push({
        robotId: robot.id,
        robotName: robot.name,
        ...(rowMapId ? { mapId: rowMapId } : {}),
        ...(rowMapName !== undefined ? { mapName: rowMapName } : {}),
        ...(missionId ? { missionId } : {}),
        missionName: mission?.name ?? `Mission ${missionId ?? ''}`.trim(),
        status: status.status as OngoingMissionView['status'],
        ...(status.waypointIndex !== undefined ? { waypointIndex: status.waypointIndex } : {}),
        ...(status.totalWaypoints !== undefined ? { totalWaypoints: status.totalWaypoints } : {}),
        ...(startedAt ? { startedAt } : {}),
        ...(status.updatedAt !== undefined ? { updatedAt: status.updatedAt } : {}),
        ...(status.lastSeenTs !== undefined ? { lastSeenTs: status.lastSeenTs } : {}),
        ...(status.message ? { message: status.message } : {}),
      });
    }

    rows.sort((left, right) => {
      const leftPinned = selectedRobotId !== null && left.robotId === selectedRobotId ? 1 : 0;
      const rightPinned = selectedRobotId !== null && right.robotId === selectedRobotId ? 1 : 0;
      if (leftPinned !== rightPinned) return rightPinned - leftPinned;
      const rankDiff = resolveMissionSortRank(left.status) - resolveMissionSortRank(right.status);
      if (rankDiff !== 0) return rankDiff;
      return left.robotName.localeCompare(right.robotName);
    });

    return rows;
  }, [
    mapNameById,
    missionClocks,
    missionStatusByRobot,
    resolveMissionContext,
    robots,
    selectedRobotId,
  ]);

  const handleSidebarRobotSelect = useCallback(
    (robot: Robot | null) => {
      setPendingMissionStart(null);
      setFocusedMission(null);
      setStartMissionId(null);
      handleSelectRobot(robot);
      setStartRobotId(robot?.id ?? null);
    },
    [handleSelectRobot]
  );

  const acknowledgeEmergencyAlert = useCallback(() => {
    setEmergencyAlerts(current => current.slice(1));
  }, []);

  return (
    <>
      <DashboardLayout
        emergencyHeader={{
          summary: emergencySummary,
          pendingDispatch: emergencyPendingDispatch !== null,
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
            <OccupancyMap
              mapId={activeMapId}
              onMapChange={mapId => {
                if (focusedMission) return;
                setActiveMapId(mapId);
              }}
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
                handleSidebarRobotSelect(robot);
              }}
              onMapFeaturesChange={setMapFeatures}
              setPoseMode={isSettingPose}
              onPoseConfirm={handlePoseConfirm}
              onPoseCancel={handlePoseCancel}
              highlightTagIds={highlightTagIds}
              dimNonMissionTags={dimNonMissionTags}
            />
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
            onSetStartRobot={robotId => {
              if (robotId !== startRobotId) {
                setPendingMissionStart(null);
                setFocusedMission(null);
              }
              setStartRobotId(robotId);
              if (robotId) {
                const robot = robots.find(item => item.id === robotId) ?? null;
                if (robot) {
                  handleSelectRobot(robot);
                }
              } else {
                setStartMissionId(null);
              }
            }}
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
          teleopRobot && teleopRobotId ? (
            <TeleopPanel
              robotId={teleopRobotId}
              robotName={teleopRobot.name}
              sendTeleop={sendTeleop}
              onClose={() => disableManualControl(teleopRobotId)}
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

      <Dialog open={currentEmergencyAlert !== null}>
        <DialogContent
          className="bg-card border-safety-estop/30"
          onPointerDownOutside={event => event.preventDefault()}
          onEscapeKeyDown={event => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="text-safety-estop">Emergency Active</DialogTitle>
            <DialogDescription className="text-foreground/80">
              {currentEmergencyAlert
                ? `${currentEmergencyAlert.kind === 'hardware' ? 'Hardware' : 'Software'} emergency acknowledged for ${currentEmergencyAlert.robotName}.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="destructive" onClick={acknowledgeEmergencyAlert}>
              Acknowledge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
