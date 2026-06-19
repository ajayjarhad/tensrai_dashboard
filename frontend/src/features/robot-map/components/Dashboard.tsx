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
import { loadMapAssets } from '@/lib/map/loadMapAssets';
import { worldToRosPose } from '@/lib/map/mapTransforms';
import { mergeEmergencyRuntimeIntoRobot } from '@/lib/robotStatus';
import { useRobotEmergencyStore } from '@/stores/robotEmergency';
import { type MissionStatus, useRobotMissionStore } from '@/stores/robotMission';
import { useRobotTelemetryStore } from '@/stores/robotTelemetry';
import { type Robot, RobotMode } from '@/types/robot';
import { useMapRobots } from '../hooks/useMapRobots';
import { useMissionRuns } from '../hooks/useMissionRuns';
import { useRobotMissions } from '../hooks/useRobotMissions';
import { robotHasMap, useRobotSelection } from '../hooks/useRobotSelection';
import { useRobots } from '../hooks/useRobots';
import { resolveSelectionMap } from '../utils/mapSelection';
import { DashboardLayout } from './DashboardLayout';
import { LiveOccupancyMap } from './LiveOccupancyMap';
import type { PoseConfirmPayload } from './Map/SetPoseLayer';
import { MapSelector } from './MapSelector';
import type { MissionWithContext } from './MissionDialog';
import {
  MissionDock,
  type MissionLogView,
  type OngoingMissionView,
} from './MissionDock/MissionDock';
import { Sidebar } from './Sidebar';
import { TeleopPanel } from './TeleopPanel';

const MISSION_STALE_MS = 120_000;
const MISSION_PREVIEW_STALE_MS = 30_000;

const missionTimestamp = (status?: MissionStatus) => status?.lastSeenTs ?? status?.updatedAt;

const missionIsFresh = (status?: MissionStatus, nowMs = Date.now()) => {
  const ts = missionTimestamp(status);
  if (!Number.isFinite(ts)) return false;
  const maxAgeMs =
    status?.phase === 'preview_pending' ||
    status?.phase === 'showing' ||
    status?.phase === 'start_pending'
      ? MISSION_PREVIEW_STALE_MS
      : MISSION_STALE_MS;
  return nowMs - (ts as number) <= maxAgeMs;
};

const missionIsLive = (status?: MissionStatus, nowMs = Date.now()) =>
  missionIsFresh(status, nowMs) &&
  (status?.phase === 'running' ||
    status?.phase === 'paused' ||
    status?.phase === 'showing' ||
    status?.phase === 'start_pending');

const isMissionActiveStatus = (status?: MissionStatus['phase']) =>
  status === 'running' || status === 'paused' || status === 'showing' || status === 'start_pending';

const isMissionTerminalOrIdleStatus = (status?: MissionStatus['phase']) =>
  status === 'idle' || status === 'completed' || status === 'failed' || status === 'cancelled';

const toDisplayWaypointIndex = (
  rawWaypointIndex?: number,
  totalWaypoints?: number
): number | undefined => {
  if (typeof rawWaypointIndex !== 'number' || !Number.isFinite(rawWaypointIndex)) return undefined;
  const candidate = rawWaypointIndex + 1;
  if (typeof totalWaypoints === 'number' && Number.isFinite(totalWaypoints) && totalWaypoints > 0) {
    return Math.min(Math.max(candidate, 1), totalWaypoints);
  }
  return Math.max(candidate, 1);
};

type PendingMissionPhase = Extract<
  MissionStatus['phase'],
  'preview_pending' | 'showing' | 'start_pending' | 'running' | 'paused'
>;

const resolveRuntimeStatus = (
  robot: Robot,
  mission: MissionStatus | undefined,
  nowMs: number
): RobotMode => {
  if (!mission) return robot.status;
  if (!missionIsFresh(mission, nowMs)) return robot.status;
  if (missionIsLive(mission, nowMs)) return RobotMode.MISSION;
  if (mission.mode === 'teleop') return RobotMode.TELEOP;
  if (mission.mode === 'autonomous') {
    return RobotMode.AUTONOMOUS;
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

const formatRobotNames = (names: string[]) => {
  if (names.length === 0) return '';
  if (names.length <= 3) return names.join(', ');
  return `${names.slice(0, 3).join(', ')} +${names.length - 3} more`;
};

export function Dashboard() {
  const { data: robotsData, refetch: refetchRobots } = useRobots();
  const { data: missionRunData } = useMissionRuns({ limit: 100 });
  const robotsFromApi = useMemo(() => robotsData ?? [], [robotsData]);
  const [pendingMissionStarts, setPendingMissionStarts] = useState<
    Record<string, PendingMissionStart>
  >({});
  const [focusedMission, setFocusedMission] = useState<FocusedMission | null>(null);
  const [startRobotId, setStartRobotId] = useState<string | null>(null);
  const [startMissionId, setStartMissionId] = useState<string | null>(null);
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
  const lastMissionToastRef = useRef<Record<string, number>>({});
  const missionToastsPrimedRef = useRef(false);
  const lastEmergencyAckAtRef = useRef<Record<string, number>>({});
  const hasShownInitialEmergencyPopupRef = useRef<Record<string, boolean>>({});
  const emergencyStatusSignatureRef = useRef<string>('');
  const refetchRobotsTimerRef = useRef<number | null>(null);
  const previousMissionPhaseByRobotRef = useRef<Record<string, MissionStatus['phase'] | undefined>>(
    {}
  );

  const robots = useMemo(() => {
    const nowMs = Date.now();
    return robotsFromApi.map(robot =>
      mergeEmergencyRuntimeIntoRobot(
        mergeMissionRuntimeIntoRobot(robot, missionStatusByRobot[robot.id], nowMs),
        emergencyByRobot[robot.id]
      )
    );
  }, [emergencyByRobot, missionStatusByRobot, robotsFromApi]);

  const prefetchedMapIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const mapIds = Array.from(
      new Set(robots.map(robot => robot.mapId).filter((mapId): mapId is string => Boolean(mapId)))
    ).filter(mapId => !prefetchedMapIdsRef.current.has(mapId));

    if (mapIds.length === 0) return;

    let cancelled = false;
    void (async () => {
      for (const mapId of mapIds) {
        if (cancelled) return;
        prefetchedMapIdsRef.current.add(mapId);
        try {
          await loadMapAssets({ mapId, cacheEnabled: true, timeout: 60_000 });
        } catch {
          prefetchedMapIdsRef.current.delete(mapId);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [robots]);

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

  const missionLogs = useMemo<MissionLogView[]>(() => {
    return (missionRunData ?? [])
      .filter(
        run =>
          run.status === 'COMPLETED' ||
          run.status === 'FAILED' ||
          run.status === 'UNKNOWN_TERMINATION'
      )
      .map(run => {
        const startedAt = run.startedAt ? Date.parse(run.startedAt) : undefined;
        const endedAt = run.endedAt
          ? Date.parse(run.endedAt)
          : run.lastEventAt
            ? Date.parse(run.lastEventAt)
            : Date.parse(run.updatedAt);
        const missionId = run.missionId ?? undefined;
        return {
          id: run.id,
          robotId: run.robotId,
          robotName: run.robotNameSnapshot,
          ...(missionId ? { missionId } : {}),
          missionName: run.missionNameSnapshot ?? `Mission ${missionId ?? ''}`.trim(),
          result: run.status === 'COMPLETED' ? 'completed' : 'failed',
          ...(startedAt ? { startedAt } : {}),
          endedAt,
          ...(typeof run.durationMs === 'number' ? { durationMs: run.durationMs } : {}),
          ...(typeof run.waypointIndex === 'number' ? { waypointIndex: run.waypointIndex } : {}),
          ...(typeof run.totalWaypoints === 'number' ? { totalWaypoints: run.totalWaypoints } : {}),
          ...(run.lastMessage ? { message: run.lastMessage } : {}),
        };
      });
  }, [missionRunData]);

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

  const sendTeleop = useRobotTelemetryStore(state => state.sendTeleop);
  const sendInitialPose = useRobotTelemetryStore(state => state.sendInitialPose);
  const clearPath = useRobotTelemetryStore(state => state.clearPath);

  useEffect(() => {
    hydrateMissionFromRobots(robotsFromApi);
  }, [hydrateMissionFromRobots, robotsFromApi]);

  useEffect(() => {
    const previous = previousMissionPhaseByRobotRef.current;
    const next: Record<string, MissionStatus['phase'] | undefined> = {};

    for (const [robotId, status] of Object.entries(missionStatusByRobot)) {
      const currentPhase = status?.phase;
      const previousPhase = previous[robotId];
      next[robotId] = currentPhase;
      if (!isMissionTerminalOrIdleStatus(currentPhase)) continue;
      if (previousPhase === currentPhase) continue;
      clearPath(robotId);
    }

    previousMissionPhaseByRobotRef.current = next;
  }, [clearPath, missionStatusByRobot]);

  useEffect(() => {
    syncEmergencyRobots(robotsFromApi);
  }, [robotsFromApi, syncEmergencyRobots]);

  useEffect(() => {
    const signature = robots
      .map(robot => `${robot.id}:${robot.emergency?.connectionStatus ?? 'none'}`)
      .sort()
      .join('|');
    if (!signature) return;
    if (!emergencyStatusSignatureRef.current) {
      emergencyStatusSignatureRef.current = signature;
      return;
    }
    if (emergencyStatusSignatureRef.current !== signature) {
      emergencyStatusSignatureRef.current = signature;
      if (refetchRobotsTimerRef.current !== null) {
        window.clearTimeout(refetchRobotsTimerRef.current);
      }
      refetchRobotsTimerRef.current = window.setTimeout(() => {
        refetchRobotsTimerRef.current = null;
        void refetchRobots();
      }, 400);
    }
  }, [refetchRobots, robots]);

  useEffect(
    () => () => {
      if (refetchRobotsTimerRef.current !== null) {
        window.clearTimeout(refetchRobotsTimerRef.current);
      }
    },
    []
  );

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
        const kind = robot.emergency?.hardwareEmergencyActive ? 'hardware' : 'software';
        const alertId = canShowAckPopup
          ? `ack:${robot.id}:${eventType}:${eventAt}`
          : `snapshot:${robot.id}:${kind}`;
        if (current.some(alert => alert.id === alertId)) return current;
        if (current.some(alert => alert.robotId === robot.id && alert.kind === kind))
          return current;
        return [
          ...current,
          {
            id: alertId,
            robotId: robot.id,
            robotName: robot.name,
            kind,
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
    // A selected mission may live on any of the robot's maps; follow that map,
    // otherwise default to the robot's active map.
    const { mapId: desiredMapId, clearMission } = resolveSelectionMap(
      robot,
      startMissionId,
      prioritizedMissions
    );
    if (desiredMapId && activeMapId !== desiredMapId) {
      setActiveMapId(desiredMapId);
    }
    if (clearMission) {
      setStartMissionId(null);
    }
  }, [activeMapId, prioritizedMissions, robots, setActiveMapId, startMissionId, startRobotId]);

  useEffect(() => {
    if (!startRobotId || !startMissionId) return;
    const robot = robots.find(item => item.id === startRobotId);
    if (!robot) return;
    const mission = prioritizedMissions.find(
      m => m.id === startMissionId && robotHasMap(robot, m.mapId)
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

  const pendingMissionStart = useMemo(() => {
    const preferredRobotIds = [
      ...(startRobotId ? [startRobotId] : []),
      ...(selectedRobotId && selectedRobotId !== startRobotId ? [selectedRobotId] : []),
      ...Object.keys(pendingMissionStarts),
    ];

    for (const robotId of preferredRobotIds) {
      const pending = pendingMissionStarts[robotId];
      if (pending) return pending;
    }

    return null;
  }, [pendingMissionStarts, selectedRobotId, startRobotId]);

  const pendingMissionPhase =
    pendingMissionStart && missionStatusByRobot[pendingMissionStart.robotId]
      ? (() => {
          const phase = missionStatusByRobot[pendingMissionStart.robotId]?.phase;
          return phase === 'preview_pending' ||
            phase === 'showing' ||
            phase === 'start_pending' ||
            phase === 'running' ||
            phase === 'paused'
            ? (phase as PendingMissionPhase)
            : undefined;
        })()
      : undefined;
  const pendingMissionMessage =
    pendingMissionStart && missionStatusByRobot[pendingMissionStart.robotId]
      ? missionStatusByRobot[pendingMissionStart.robotId]?.message
      : undefined;

  useEffect(() => {
    const entries = Object.entries(pendingMissionStarts);
    if (entries.length === 0) return;

    let changed = false;
    const next = { ...pendingMissionStarts };

    for (const [robotId, pending] of entries) {
      const status = missionStatusByRobot[robotId];
      if (!status) continue;
      const activeMissionId = status.currentMissionId ?? status.lastEventMissionId;
      if (activeMissionId && activeMissionId !== pending.mission.id) continue;

      if (
        status.phase === 'running' ||
        status.phase === 'completed' ||
        status.phase === 'cancelled'
      ) {
        delete next[robotId];
        changed = true;
        continue;
      }

      if (
        (status.phase === 'idle' || status.phase === 'failed') &&
        status.lastRequestType === 'SHOW_UP'
      ) {
        delete next[robotId];
        changed = true;
      }
    }

    if (changed) {
      setPendingMissionStarts(next);
      if (pendingMissionStart && !next[pendingMissionStart.robotId]) {
        setFocusedMission(current =>
          current?.robotId === pendingMissionStart.robotId &&
          current.missionId === pendingMissionStart.mission.id
            ? null
            : current
        );
      }
    }
  }, [missionStatusByRobot, pendingMissionStart, pendingMissionStarts]);

  useEffect(() => {
    const nextEntries: Record<string, PendingMissionStart> = {};

    for (const robot of robots) {
      const status = missionStatusByRobot[robot.id];
      const hasLocalPendingPreview = Boolean(pendingMissionStarts[robot.id]);
      const shouldKeepLocalShowingPreview = status?.phase === 'showing' && hasLocalPendingPreview;
      const shouldKeepLocalPendingPreview =
        hasLocalPendingPreview &&
        (status?.phase === 'preview_pending' ||
          status?.phase === 'showing' ||
          status?.phase === 'start_pending');
      if (!shouldKeepLocalPendingPreview && !missionIsFresh(status)) continue;
      if (
        !status ||
        (status.phase !== 'preview_pending' &&
          status.phase !== 'start_pending' &&
          !shouldKeepLocalShowingPreview)
      ) {
        continue;
      }

      if (!robot.mapId) continue;
      const missionId = status.currentMissionId ?? status.lastEventMissionId;
      const mission = missionId ? resolveMissionContext(missionId, robot.mapId) : null;
      if (!mission) continue;
      nextEntries[robot.id] = { robotId: robot.id, mission };
    }

    const currentKeys = Object.keys(pendingMissionStarts);
    const nextKeys = Object.keys(nextEntries);
    const isSame =
      currentKeys.length === nextKeys.length &&
      currentKeys.every(
        robotId => nextEntries[robotId]?.mission.id === pendingMissionStarts[robotId]?.mission.id
      );

    if (!isSame) {
      setPendingMissionStarts(nextEntries);
    }

    if ((startRobotId ?? selectedRobotId) || nextKeys.length === 0) return;

    const firstPending = nextEntries[nextKeys[0]];
    if (!firstPending) return;
    setStartRobotId(firstPending.robotId);
    setStartMissionId(firstPending.mission.id);
    setFocusedMission(current =>
      current?.robotId === firstPending.robotId &&
      current.missionId === firstPending.mission.id &&
      current.mapId === firstPending.mission.mapId
        ? current
        : {
            robotId: firstPending.robotId,
            missionId: firstPending.mission.id,
            mapId: firstPending.mission.mapId,
          }
    );
    if (activeMapId !== firstPending.mission.mapId) {
      setActiveMapId(firstPending.mission.mapId);
    }
  }, [
    activeMapId,
    missionStatusByRobot,
    pendingMissionStarts,
    resolveMissionContext,
    robots,
    selectedRobotId,
    setActiveMapId,
    startRobotId,
  ]);

  useEffect(() => {
    if (!missionToastsPrimedRef.current) {
      if (robots.length === 0) return;
      for (const robot of robots) {
        const status = missionStatusByRobot[robot.id];
        if (status?.lastEventAt) {
          lastMissionToastRef.current[robot.id] = status.lastEventAt;
        }
      }
      missionToastsPrimedRef.current = true;
      return;
    }

    for (const robot of robots) {
      const status = missionStatusByRobot[robot.id];
      if (!status?.lastEvent || !status.lastEventAt) continue;

      const lastSeen = lastMissionToastRef.current[robot.id] ?? 0;
      if (status.lastEventAt <= lastSeen) continue;
      lastMissionToastRef.current[robot.id] = status.lastEventAt;

      const missionId = status.lastEventMissionId ?? status.currentMissionId;
      const missionName =
        (missionId ? resolveMissionContext(missionId, robot.mapId)?.name : null) ??
        (missionId ? `Mission ${missionId}` : 'Mission');
      const prefix = `${robot.name}: `;

      if (status.lastEvent === 'MISSION_START_ACK') {
        if (status.lastEventStatus === 'success') {
          toast.success(`${prefix}${missionName} started`);
        } else {
          toast.error(status.message ?? `${prefix}${missionName} failed to start`);
        }
        continue;
      }

      if (status.lastEvent === 'MISSION_CONTROL_ACK') {
        const requestType = status.lastRequestType ?? 'UNKNOWN';
        if (status.lastEventStatus === 'success') {
          if (requestType === 'SHOW_UP') toast.success(`${prefix}${missionName} ready to start`);
          if (requestType === 'PAUSE') toast.message(`${prefix}${missionName} paused`);
          if (requestType === 'RESUME') toast.success(`${prefix}${missionName} resumed`);
          if (requestType === 'CANCEL') toast.message(`${prefix}${missionName} cancelled`);
        } else {
          toast.error(status.message ?? `${prefix}${missionName} control failed`);
        }
        continue;
      }

      if (status.lastEvent === 'MISSION_COMPLETED') {
        if (status.lastEventStatus === 'success') {
          toast.success(`${prefix}${missionName} completed`);
        } else if (status.lastEventStatus === 'cancelled') {
          toast.message(`${prefix}${missionName} cancelled`);
        } else {
          toast.error(`${prefix}${missionName} failed`);
        }
        continue;
      }

      if (status.lastEvent === 'MODE_CHANGE_ACK') {
        if (status.lastEventStatus === 'success') {
          toast.message(
            status.mode
              ? `${prefix}mode changed to ${status.mode}`
              : `${prefix}mode changed successfully`
          );
        } else {
          toast.error(status.message ?? `${prefix}mode change failed`);
        }
        continue;
      }

      if (status.lastEvent === 'WAYPOINT_ACK') {
        const displayWaypointIndex = toDisplayWaypointIndex(
          status.waypointIndex,
          status.totalWaypoints
        );
        if (displayWaypointIndex && status.totalWaypoints) {
          toast.message(
            `${prefix}${missionName}: waypoint ${displayWaypointIndex}/${status.totalWaypoints}`
          );
        } else {
          toast.message(status.message ?? `${prefix}${missionName}: waypoint reached`);
        }
      }
    }
  }, [missionStatusByRobot, resolveMissionContext, robots]);

  const handleStartSetPose = () => {
    if (!selectedRobotId || !selectedRobot?.mapId) {
      toast.error('Select a robot before setting pose');
      return;
    }
    setIsSettingPose(true);
    toast.message(
      'Set pose: click anywhere on the map, drag to rotate, then confirm. Esc to cancel.'
    );
  };

  const handlePoseConfirm = (payload: PoseConfirmPayload) => {
    if (!selectedRobotId) {
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

    const dispatchResult = sendInitialPose(selectedRobotId, message);
    setIsSettingPose(false);
    if (dispatchResult.status === 'sent') {
      toast.success('Pose command sent');
      return;
    }
    if (dispatchResult.status === 'queued') {
      toast.message('Pose command queued while telemetry reconnects');
      return;
    }
    toast.error('Unable to send pose command: telemetry socket unavailable');
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

  const dispatchShowUpPreview = useCallback(
    (robotId: string, mission: MissionWithContext) => {
      const dispatched = dispatchMissionEvent(
        robotId,
        'SHOW_UP',
        { missionId: mission.id },
        {
          queuedMessage: `SHOW_UP queued for ${mission.name}`,
          errorMessage: 'Unable to send SHOW_UP command',
        }
      );
      if (!dispatched) return false;

      setPendingMissionStarts(current => ({
        ...current,
        [robotId]: { robotId, mission },
      }));
      setFocusedMission({ robotId, missionId: mission.id, mapId: mission.mapId });
      setStartRobotId(robotId);
      setStartMissionId(mission.id);
      setActiveMapId(mission.mapId);
      const robot = robots.find(item => item.id === robotId) ?? null;
      if (robot) handleSelectRobot(robot);
      return true;
    },
    [dispatchMissionEvent, handleSelectRobot, robots, setActiveMapId]
  );

  const handleFleetEmergencyDispatch = useCallback(
    async (desiredStatus: boolean) => {
      const result = await sendFleetSoftwareEmergency(desiredStatus);
      const successfulNames = result.results
        .filter(entry => entry.applied)
        .map(entry => entry.robotName ?? entry.robotId);
      const successCount = result.results.filter(entry => entry.applied).length;
      const failureCount = result.results.length - successCount;
      const failureSummary = result.results
        .filter(entry => !entry.applied)
        .map(entry => `${entry.robotName ?? entry.robotId}: ${entry.error ?? 'unknown error'}`)
        .join('; ');
      const hardwareLockedCount = result.results.filter(
        entry => entry.applied && entry.hardwareEmergencyActive
      ).length;
      const successSummary = formatRobotNames(successfulNames);

      if (desiredStatus) {
        if (result.status === 'success') {
          toast.success(
            successSummary
              ? `Emergency sent to ${successSummary}`
              : `Emergency sent to ${successCount} robot${successCount === 1 ? '' : 's'}`
          );
        } else if (result.status === 'partial_failure') {
          toast.error(
            successSummary
              ? `Emergency sent to ${successSummary}; ${failureCount} failed`
              : `Emergency sent to ${successCount} robots, ${failureCount} failed`,
            {
              description: failureSummary || undefined,
            }
          );
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
        toast.error(
          successSummary
            ? `Release sent to ${successSummary}; ${failureCount} failed`
            : `Release sent to ${successCount} robots, ${failureCount} failed`,
          {
            description: failureSummary || undefined,
          }
        );
        return;
      }

      toast.success(
        successSummary
          ? `Release sent to ${successSummary}`
          : `Release sent to ${successCount} robot${successCount === 1 ? '' : 's'}`
      );
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
      const robotPendingPhase = missionStatusByRobot[robotId]?.phase;
      if (
        pendingMissionStarts[robotId] &&
        pendingMissionStarts[robotId]?.mission.id !== mission.id &&
        (robotPendingPhase === 'preview_pending' ||
          robotPendingPhase === 'showing' ||
          robotPendingPhase === 'start_pending')
      ) {
        void dispatchShowUpPreview(robotId, mission);
        return;
      }
      void dispatchShowUpPreview(robotId, mission);
    },
    [
      dispatchMissionEvent,
      dispatchShowUpPreview,
      isRobotEmergencyBlocked,
      missionStatusByRobot,
      pendingMissionStarts,
      resolveMissionForRobot,
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
  }, [dispatchMissionEvent, isRobotEmergencyBlocked, pendingMissionStart]);

  const handleCancelMissionStart = useCallback(() => {
    if (pendingMissionStart) {
      setPendingMissionStarts(current => {
        const next = { ...current };
        delete next[pendingMissionStart.robotId];
        return next;
      });
      setFocusedMission(current =>
        current?.robotId === pendingMissionStart.robotId &&
        current.missionId === pendingMissionStart.mission.id
          ? null
          : current
      );
    } else {
      setFocusedMission(null);
    }
  }, [pendingMissionStart]);

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
      if (!robotId || selectedRobotId !== robotId) {
        toast.error('Select a robot before entering manual control');
        return;
      }
      if (teleopRobotId && teleopRobotId !== robotId) {
        sendModeChange(teleopRobotId, 'autonomousActive');
      }
      if (teleopRobotId !== robotId) {
        sendModeChange(robotId, 'teleopActive');
      }
      setTeleopRobotId(robotId);
      setIsSidebarOpen(true);
    },
    [selectedRobotId, sendModeChange, setIsSidebarOpen, teleopRobotId]
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
      setTeleopRobotId(null);
    }
  }, [selectedRobotId, teleopRobotId]);

  useEffect(() => {
    if (!teleopRobotId) return;
    const teleopStatus = missionStatusByRobot[teleopRobotId];
    const liveMode =
      teleopStatus?.mode ?? robots.find(robot => robot.id === teleopRobotId)?.runtimeMode;
    if (liveMode && liveMode !== 'teleop') {
      setTeleopRobotId(null);
    }
  }, [missionStatusByRobot, robots, teleopRobotId]);

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
      if (!status || !isMissionActiveStatus(status.phase)) continue;
      if (!missionIsFresh(status, nowMs)) continue;
      const isPreviewLike = status.phase === 'showing' || status.phase === 'start_pending';
      if (isPreviewLike && !pendingMissionStarts[robot.id]) continue;
      const missionId = status.currentMissionId ?? status.lastEventMissionId;
      const mission = resolveMissionContext(missionId, robot.mapId);
      const parsedStartedAt = status.startedAt ? Date.parse(status.startedAt) : undefined;
      const startedAt = Number.isFinite(parsedStartedAt) ? parsedStartedAt : undefined;
      const rowMapId = mission?.mapId ?? robot.mapId;
      const rowMapName = mission?.mapName ?? (robot.mapId ? mapNameById[robot.mapId] : undefined);
      const displayWaypointIndex = toDisplayWaypointIndex(
        status.waypointIndex,
        status.totalWaypoints
      );

      rows.push({
        robotId: robot.id,
        robotName: robot.name,
        ...(rowMapId ? { mapId: rowMapId } : {}),
        ...(rowMapName !== undefined ? { mapName: rowMapName } : {}),
        ...(missionId ? { missionId } : {}),
        missionName: mission?.name ?? `Mission ${missionId ?? ''}`.trim(),
        status: (status.phase === 'start_pending'
          ? 'showing'
          : status.phase) as OngoingMissionView['status'],
        ...(displayWaypointIndex !== undefined ? { waypointIndex: displayWaypointIndex } : {}),
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
    missionStatusByRobot,
    pendingMissionStarts,
    resolveMissionContext,
    robots,
    selectedRobotId,
  ]);

  const handleSidebarRobotSelect = useCallback(
    (robot: Robot | null) => {
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
                onMapFeaturesChange={setMapFeatures}
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
            onSetStartRobot={robotId => {
              if (robotId !== startRobotId) {
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
                ? `${currentEmergencyAlert.kind === 'hardware' ? 'Hardware' : 'Software'} emergency set on ${currentEmergencyAlert.robotName}.`
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
