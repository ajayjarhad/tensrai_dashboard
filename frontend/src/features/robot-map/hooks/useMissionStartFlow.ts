import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { toast } from 'sonner';
import { isPreviewLikePhase } from '@/lib/missionPhases';
import type { MissionStatus } from '@/stores/robotMission';
import type { Robot } from '@/types/robot';
import type {
  FocusedMission,
  MissionWithContext,
  PendingMissionStart,
  ResolveMissionContext,
} from '../types';
import { resolveSelectionMap, robotHasMap } from '../utils/mapSelection';
import { missionIsFresh } from '../utils/missionRuntime';

const PENDING_MISSION_PHASES = [
  'preview_pending',
  'showing',
  'start_pending',
  'running',
  'paused',
] as const;
type PendingMissionPhase = (typeof PENDING_MISSION_PHASES)[number];

const isPendingMissionPhase = (phase: MissionStatus['phase']): phase is PendingMissionPhase =>
  (PENDING_MISSION_PHASES as readonly string[]).includes(phase);

type MissionStartFlowOptions = {
  robots: Robot[];
  prioritizedMissions: MissionWithContext[];
  missionStatusByRobot: Record<string, MissionStatus>;
  resolveMissionContext: ResolveMissionContext;
  selectedRobotId: string | null;
  activeMapId: string | null;
  setActiveMapId: Dispatch<SetStateAction<string | null>>;
  handleSelectRobot: (robot: Robot | null) => void;
  focusedMission: FocusedMission | null;
  setFocusedMission: Dispatch<SetStateAction<FocusedMission | null>>;
  dispatchMissionEvent: (
    robotId: string,
    event: string,
    payload: Record<string, unknown>,
    options?: { queuedMessage?: string; errorMessage?: string }
  ) => boolean;
  isRobotEmergencyBlocked: (robotId: string) => boolean;
};

export const useMissionStartFlow = ({
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
}: MissionStartFlowOptions) => {
  const [pendingMissionStarts, setPendingMissionStarts] = useState<
    Record<string, PendingMissionStart>
  >({});
  const [startRobotId, setStartRobotId] = useState<string | null>(null);
  const [startMissionId, setStartMissionId] = useState<string | null>(null);

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
  }, [
    activeMapId,
    prioritizedMissions,
    robots,
    setActiveMapId,
    setFocusedMission,
    startMissionId,
    startRobotId,
  ]);

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

  const pendingStatus = pendingMissionStart
    ? missionStatusByRobot[pendingMissionStart.robotId]
    : undefined;
  const pendingMissionPhase =
    pendingStatus && isPendingMissionPhase(pendingStatus.phase) ? pendingStatus.phase : undefined;
  const pendingMissionMessage = pendingStatus?.message;

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
  }, [missionStatusByRobot, pendingMissionStart, pendingMissionStarts, setFocusedMission]);

  useEffect(() => {
    const nextEntries: Record<string, PendingMissionStart> = {};

    for (const robot of robots) {
      const status = missionStatusByRobot[robot.id];
      const hasLocalPendingPreview = Boolean(pendingMissionStarts[robot.id]);
      const shouldKeepLocalShowingPreview = status?.phase === 'showing' && hasLocalPendingPreview;
      const shouldKeepLocalPendingPreview =
        hasLocalPendingPreview && isPreviewLikePhase(status?.phase);
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
    setFocusedMission,
    startRobotId,
  ]);

  const resolveMissionForRobot = useCallback(
    (robotId: string, missionId: string) => {
      const robot = robots.find(item => item.id === robotId);
      if (!robot?.mapId) return null;
      return prioritizedMissions.find(m => m.id === missionId && m.mapId === robot.mapId) ?? null;
    },
    [prioritizedMissions, robots]
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
    [dispatchMissionEvent, handleSelectRobot, robots, setActiveMapId, setFocusedMission]
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
      void dispatchShowUpPreview(robotId, mission);
    },
    [dispatchShowUpPreview, isRobotEmergencyBlocked, resolveMissionForRobot]
  );

  const handleConfirmMissionStart = useCallback(() => {
    if (!pendingMissionStart) return;
    if (isRobotEmergencyBlocked(pendingMissionStart.robotId)) {
      toast.error('Controls unavailable while emergency stop is active');
      return;
    }
    dispatchMissionEvent(
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
  }, [pendingMissionStart, setFocusedMission]);

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
    [handleSelectRobot, resolveMissionContext, robots, setActiveMapId, setFocusedMission]
  );

  const handleClearMissionFocus = useCallback(() => {
    setFocusedMission(null);
  }, [setFocusedMission]);

  const handleSidebarRobotSelect = useCallback(
    (robot: Robot | null) => {
      setFocusedMission(null);
      setStartMissionId(null);
      handleSelectRobot(robot);
      setStartRobotId(robot?.id ?? null);
    },
    [handleSelectRobot, setFocusedMission]
  );

  const selectStartRobot = (robotId: string | null) => {
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
  };

  return {
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
  };
};
