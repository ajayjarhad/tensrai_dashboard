const MISSION_CONTROL_EVENTS = [
  'SHOW_UP',
  'START_MISSION',
  'PAUSE_MISSION',
  'RESUME_MISSION',
  'CANCEL_MISSION',
  'CHANGE_MODE',
] as const;

const MISSION_STATUS_EVENTS = [
  'MISSION_CONTROL_ACK',
  'MISSION_START_ACK',
  'MISSION_COMPLETED',
  'WAYPOINT_ACK',
  'MODE_CHANGE_ACK',
  'ROBOT_STATUS_UPDATE',
] as const;

const isRuntimeMode = (value: unknown): value is 'teleop' | 'autonomous' =>
  value === 'teleop' || value === 'autonomous';

export type MissionStatePhase =
  | 'idle'
  | 'preview_pending'
  | 'showing'
  | 'start_pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type MissionState = {
  status: MissionStatePhase;
  phase: MissionStatePhase;
  currentMissionId?: string | undefined;
  requestIdLast?: string | undefined;
  runId?: string | undefined;
  startedAt?: string | undefined;
  lastEvent?: string | undefined;
  message?: string | undefined;
  updatedAt: string;
  lastEventStatus?: string | undefined;
  lastRequestType?: string | undefined;
  lastEventAt?: number | undefined;
  lastEventMissionId?: string | undefined;
  waypointIndex?: number | undefined;
  totalWaypoints?: number | undefined;
  mode?: 'teleop' | 'autonomous' | undefined;
  batteryPercentage?: number | null | undefined;
  chargingStatus?: string | null | undefined;
  lastSeenTs?: number | undefined;
  runtimeUpdatedAt?: number | undefined;
  modeUpdatedAt?: number | undefined;
};

const missionStateByRobot = new Map<string, MissionState>();

const nowIso = () => new Date().toISOString();
const nowMs = () => Date.now();

export const getMissionState = (robotId: string): MissionState => {
  return (
    missionStateByRobot.get(robotId) ?? {
      status: 'idle',
      phase: 'idle',
      updatedAt: nowIso(),
    }
  );
};

export const deriveRobotModeFromMissionState = (
  robotId: string
): 'MISSION' | 'TELEOP' | 'AUTONOMOUS' | undefined => {
  const state = getMissionState(robotId);
  if (
    state.phase === 'showing' ||
    state.phase === 'start_pending' ||
    state.phase === 'running' ||
    state.phase === 'paused'
  ) {
    return 'MISSION';
  }
  if (state.mode === 'teleop') {
    return 'TELEOP';
  }
  if (state.mode === 'autonomous') {
    return 'AUTONOMOUS';
  }
  return undefined;
};

export const setMissionState = (
  robotId: string,
  next: Partial<MissionState>,
  updatedAtMs = nowMs()
) => {
  const current = getMissionState(robotId);
  const safeMs = Number.isFinite(updatedAtMs) ? updatedAtMs : nowMs();
  const nextPhase = next.phase ?? next.status ?? current.phase;
  const merged: MissionState = {
    ...current,
    ...next,
    phase: nextPhase,
    status: nextPhase,
    updatedAt: new Date(safeMs).toISOString(),
  };
  missionStateByRobot.set(robotId, merged);
  return merged;
};

const normalizeMissionId = (value: unknown): string | undefined => {
  if (value === null || value === undefined) return undefined;
  const str = String(value).trim();
  return str.length ? str : undefined;
};

const normalizeRequestId = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
};

const normalizeRequestType = (value: unknown): string | undefined => {
  if (!value) return undefined;
  const raw = String(value).trim().toUpperCase();
  if (raw === 'PAUSE_MISSION' || raw === 'PAUSE') return 'PAUSE';
  if (raw === 'RESUME_MISSION' || raw === 'RESUME') return 'RESUME';
  if (raw === 'CANCEL_MISSION' || raw === 'CANCEL') return 'CANCEL';
  if (raw === 'START_MISSION') return 'START_MISSION';
  if (raw === 'SHOW_UP') return 'SHOW_UP';
  return raw;
};

const missionPhaseFromRuntime = (value: unknown): MissionStatePhase | undefined => {
  const status = String(value ?? '').toUpperCase();
  if (status === 'ACTIVE') return 'running';
  if (status === 'PAUSED') return 'paused';
  if (status === 'IDLE') return 'idle';
  return undefined;
};

const shouldKeepWaypointProgress = (status: MissionStatePhase | undefined) =>
  status === 'running' || status === 'paused' || status === 'showing' || status === 'start_pending';

const timestampMs = (value: unknown): number | undefined => {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const eventTimestampMs = (event: string, payload: any): number => {
  if (event === 'ROBOT_STATUS_UPDATE') {
    return timestampMs(payload?.timestamp) ?? nowMs();
  }
  if (event === 'WAYPOINT_ACK') {
    return timestampMs(payload?.time) ?? nowMs();
  }
  if (event === 'MISSION_COMPLETED') {
    return timestampMs(payload?.completionTime) ?? nowMs();
  }
  return timestampMs(payload?.timestamp) ?? timestampMs(payload?.time) ?? nowMs();
};

const shouldApplyEvent = (current: MissionState, nextTimestampMs: number) => {
  const currentTs = current.lastEventAt ?? Date.parse(current.updatedAt);
  if (!Number.isFinite(currentTs)) return true;
  return nextTimestampMs >= currentTs;
};

const shouldAcceptRequest = (
  current: MissionState,
  payloadRequestId: string | undefined,
  appliedAtMs: number
) => {
  if (!payloadRequestId || !current.requestIdLast) return true;
  if (payloadRequestId === current.requestIdLast) return true;
  const currentTs = current.lastEventAt ?? Date.parse(current.updatedAt);
  if (!Number.isFinite(currentTs)) return false;
  return appliedAtMs >= currentTs;
};

export const clearMissionState = (robotId: string) => {
  missionStateByRobot.delete(robotId);
};

const persistedRunStatusToPhase = (value: unknown): MissionStatePhase => {
  const status = String(value ?? '').toUpperCase();
  if (status === 'PREVIEW_PENDING') return 'preview_pending';
  if (status === 'SHOWING') return 'showing';
  if (status === 'START_PENDING') return 'start_pending';
  if (status === 'RUNNING') return 'running';
  if (status === 'PAUSED') return 'paused';
  if (status === 'COMPLETED') return 'completed';
  if (status === 'FAILED') return 'failed';
  if (status === 'CANCELLED') return 'cancelled';
  if (status === 'UNKNOWN_TERMINATION') return 'failed';
  return 'idle';
};

export const hydrateMissionStateFromPersistedRun = (
  robotId: string,
  run:
    | {
        missionId?: string | null;
        runId?: string | null;
        requestIdLast?: string | null;
        startedAt?: Date | string | null;
        waypointIndex?: number | null;
        totalWaypoints?: number | null;
        lastMessage?: string | null;
        lastEvent?: string | null;
        lastEventAt?: Date | string | null;
        updatedAt?: Date | string | null;
        status?: string | null;
        phase?: string | null;
      }
    | null
    | undefined
) => {
  if (!run) return getMissionState(robotId);

  const updatedAtMs =
    (run.lastEventAt ? Date.parse(String(run.lastEventAt)) : undefined) ??
    (run.updatedAt ? Date.parse(String(run.updatedAt)) : undefined) ??
    nowMs();
  const phase = persistedRunStatusToPhase(run.phase ?? run.status);

  return setMissionState(
    robotId,
    {
      phase,
      currentMissionId: normalizeMissionId(run.missionId),
      requestIdLast: normalizeRequestId(run.requestIdLast),
      runId: normalizeRequestId(run.runId),
      startedAt:
        run.startedAt !== null && run.startedAt !== undefined ? String(run.startedAt) : undefined,
      waypointIndex:
        typeof run.waypointIndex === 'number' && Number.isFinite(run.waypointIndex)
          ? run.waypointIndex
          : undefined,
      totalWaypoints:
        typeof run.totalWaypoints === 'number' && Number.isFinite(run.totalWaypoints)
          ? run.totalWaypoints
          : undefined,
      lastEvent: typeof run.lastEvent === 'string' ? run.lastEvent : undefined,
      message: typeof run.lastMessage === 'string' ? run.lastMessage : undefined,
      lastEventAt: Number.isFinite(updatedAtMs) ? updatedAtMs : nowMs(),
    },
    Number.isFinite(updatedAtMs) ? updatedAtMs : nowMs()
  );
};

export const recordMissionCommandIntent = (robotId: string, event: string, payload: any) => {
  const current = getMissionState(robotId);
  const missionId = normalizeMissionId(payload?.missionId ?? payload?.missionID);
  const requestId = normalizeRequestId(payload?.requestId);
  const requestType = normalizeRequestType(event);
  const appliedAtMs = nowMs();

  if (event === 'SHOW_UP') {
    return setMissionState(
      robotId,
      {
        phase: 'preview_pending',
        currentMissionId: missionId,
        requestIdLast: requestId,
        lastEvent: event,
        lastEventStatus: 'pending',
        lastRequestType: requestType,
        lastEventMissionId: missionId,
        lastEventAt: appliedAtMs,
        message: 'SHOW_UP sent',
        runId: undefined,
      },
      appliedAtMs
    );
  }

  if (event === 'START_MISSION') {
    return setMissionState(
      robotId,
      {
        phase: 'start_pending',
        currentMissionId: missionId ?? current.currentMissionId,
        requestIdLast: requestId,
        lastEvent: event,
        lastEventStatus: 'pending',
        lastRequestType: requestType,
        lastEventMissionId: missionId ?? current.currentMissionId,
        lastEventAt: appliedAtMs,
        message: 'START_MISSION sent',
      },
      appliedAtMs
    );
  }

  if (event === 'PAUSE_MISSION' || event === 'RESUME_MISSION' || event === 'CANCEL_MISSION') {
    return setMissionState(
      robotId,
      {
        requestIdLast: requestId,
        lastEvent: event,
        lastEventStatus: 'pending',
        lastRequestType: requestType,
        lastEventMissionId: missionId ?? current.currentMissionId,
        lastEventAt: appliedAtMs,
      },
      appliedAtMs
    );
  }

  return current;
};

export const updateMissionFromEvent = (robotId: string, event: string, payload: any) => {
  if (!event) return;

  const current = getMissionState(robotId);
  const appliedAtMs = eventTimestampMs(event, payload);
  if (!shouldApplyEvent(current, appliedAtMs)) {
    return current;
  }

  if (event === 'MISSION_START_ACK') {
    const ackStatus = typeof payload?.status === 'string' ? payload.status : undefined;
    const missionId = normalizeMissionId(payload?.missionId ?? payload?.missionID);
    const requestId = normalizeRequestId(payload?.requestId);
    if (!shouldAcceptRequest(current, requestId, appliedAtMs)) return current;
    const message = typeof payload?.message === 'string' ? payload.message : current.message;
    const runId = normalizeRequestId(payload?.runId) ?? current.runId;
    const startedAt =
      typeof payload?.startedAt === 'string' && payload.startedAt.trim().length > 0
        ? payload.startedAt
        : current.startedAt;

    if (ackStatus === 'success') {
      return setMissionState(
        robotId,
        {
          phase: 'running',
          currentMissionId: missionId ?? current.currentMissionId,
          requestIdLast: requestId ?? current.requestIdLast,
          runId,
          startedAt,
          waypointIndex: 0,
          totalWaypoints: current.totalWaypoints,
          lastEvent: event,
          lastEventStatus: ackStatus,
          lastEventMissionId: missionId ?? current.currentMissionId,
          lastEventAt: appliedAtMs,
          message,
        },
        appliedAtMs
      );
    }

    return setMissionState(
      robotId,
      {
        phase: current.phase === 'start_pending' ? 'showing' : current.phase,
        currentMissionId: missionId ?? current.currentMissionId,
        requestIdLast: requestId ?? current.requestIdLast,
        lastEvent: event,
        lastEventStatus: ackStatus,
        lastEventMissionId: missionId ?? current.currentMissionId,
        lastEventAt: appliedAtMs,
        message,
      },
      appliedAtMs
    );
  }

  if (event === 'MISSION_CONTROL_ACK') {
    const requestType = normalizeRequestType(payload?.requestType);
    const ackStatus = typeof payload?.status === 'string' ? payload.status : undefined;
    const missionId = normalizeMissionId(payload?.missionId ?? payload?.missionID);
    const requestId = normalizeRequestId(payload?.requestId);
    if (!shouldAcceptRequest(current, requestId, appliedAtMs)) return current;
    const message = typeof payload?.message === 'string' ? payload.message : current.message;

    let phase = current.phase;
    if (ackStatus === 'success') {
      if (requestType === 'SHOW_UP') phase = 'showing';
      if (requestType === 'PAUSE') phase = 'paused';
      if (requestType === 'RESUME') phase = 'running';
      if (requestType === 'CANCEL') phase = 'cancelled';
    } else if (requestType === 'SHOW_UP' && current.phase === 'preview_pending') {
      phase = 'idle';
    }

    const clearMission = ackStatus === 'success' && requestType === 'CANCEL';
    const clearWaypoint =
      (ackStatus === 'success' && requestType === 'SHOW_UP') ||
      (ackStatus === 'success' && requestType === 'CANCEL');

    return setMissionState(
      robotId,
      {
        phase,
        currentMissionId: clearMission ? undefined : (missionId ?? current.currentMissionId),
        requestIdLast: requestId ?? current.requestIdLast,
        runId: clearMission ? undefined : current.runId,
        startedAt: clearMission ? undefined : current.startedAt,
        waypointIndex: clearWaypoint ? undefined : current.waypointIndex,
        totalWaypoints: clearWaypoint ? undefined : current.totalWaypoints,
        lastEvent: event,
        lastEventStatus: ackStatus,
        lastRequestType: requestType,
        lastEventMissionId: missionId ?? current.currentMissionId,
        lastEventAt: appliedAtMs,
        message,
      },
      appliedAtMs
    );
  }

  if (event === 'MISSION_COMPLETED') {
    const rawStatus = String(payload?.status ?? '').toLowerCase();
    const missionId = normalizeMissionId(payload?.missionId ?? payload?.missionID);
    const runId = normalizeRequestId(payload?.runId) ?? current.runId;
    const resolvedPhase: MissionStatePhase =
      rawStatus === 'success' ? 'completed' : rawStatus === 'cancelled' ? 'cancelled' : 'failed';
    const message = typeof payload?.message === 'string' ? payload.message : current.message;
    return setMissionState(
      robotId,
      {
        phase: resolvedPhase,
        currentMissionId: missionId ?? current.currentMissionId,
        runId,
        lastEvent: event,
        lastEventStatus: rawStatus,
        lastEventMissionId: missionId ?? current.currentMissionId,
        lastEventAt: appliedAtMs,
        message,
      },
      appliedAtMs
    );
  }

  if (event === 'WAYPOINT_ACK') {
    const missionId = normalizeMissionId(payload?.missionId ?? payload?.missionID);
    const runId = normalizeRequestId(payload?.runId) ?? current.runId;
    const waypointIndex =
      typeof payload?.waypointIndex === 'number' && Number.isFinite(payload.waypointIndex)
        ? payload.waypointIndex
        : current.waypointIndex;
    const totalWaypoints =
      typeof payload?.totalWaypoints === 'number' && Number.isFinite(payload.totalWaypoints)
        ? payload.totalWaypoints
        : current.totalWaypoints;
    const message = typeof payload?.message === 'string' ? payload.message : current.message;
    const ackStatus =
      typeof payload?.status === 'string' ? payload.status : current.lastEventStatus;
    return setMissionState(
      robotId,
      {
        currentMissionId: missionId ?? current.currentMissionId,
        runId,
        lastEvent: event,
        lastEventStatus: ackStatus,
        lastEventMissionId: missionId ?? current.currentMissionId,
        lastEventAt: appliedAtMs,
        waypointIndex,
        totalWaypoints,
        message,
      },
      appliedAtMs
    );
  }

  if (event === 'MODE_CHANGE_ACK') {
    const modeTimestamp =
      timestampMs(payload?.timestamp) ?? timestampMs(payload?.time) ?? current.modeUpdatedAt;
    const mode = isRuntimeMode(payload?.currentMode) ? payload.currentMode : current.mode;
    const requestId = normalizeRequestId(payload?.requestId);
    const ackStatus =
      typeof payload?.status === 'string' ? payload.status : current.lastEventStatus;
    const message =
      typeof payload?.message === 'string'
        ? payload.message
        : typeof payload?.error === 'string'
          ? payload.error
          : current.message;
    return setMissionState(
      robotId,
      {
        mode,
        modeUpdatedAt: modeTimestamp,
        lastEvent: event,
        lastEventStatus: ackStatus,
        lastEventAt: appliedAtMs,
        message,
        requestIdLast: requestId ?? current.requestIdLast,
      },
      appliedAtMs
    );
  }

  if (event === 'ROBOT_STATUS_UPDATE') {
    if (current.runtimeUpdatedAt !== undefined && appliedAtMs < current.runtimeUpdatedAt) {
      return current;
    }

    const phase = missionPhaseFromRuntime(payload?.mission?.status) ?? current.phase;
    const missionId = normalizeMissionId(payload?.mission?.currentMissionId);
    const hasMissionId =
      payload?.mission !== undefined &&
      payload?.mission !== null &&
      Object.hasOwn(payload.mission, 'currentMissionId');
    const nextMissionId = hasMissionId ? missionId : current.currentMissionId;
    const clearMissionId = phase === 'idle' && !hasMissionId;
    const missionChanged = hasMissionId && missionId !== current.currentMissionId;
    const clearWaypoint = missionChanged || !shouldKeepWaypointProgress(phase);
    const mode = isRuntimeMode(payload?.mode) ? payload.mode : current.mode;
    const battery =
      typeof payload?.batteryPercentage === 'number' && Number.isFinite(payload.batteryPercentage)
        ? payload.batteryPercentage
        : payload?.batteryPercentage === null
          ? null
          : current.batteryPercentage;
    const chargingStatus =
      typeof payload?.chargingStatus === 'string'
        ? payload.chargingStatus
        : payload?.chargingStatus === null
          ? null
          : current.chargingStatus;
    const runId =
      normalizeRequestId(payload?.mission?.runId) ?? (phase === 'idle' ? undefined : current.runId);
    const startedAt =
      typeof payload?.mission?.startedAt === 'string' && payload.mission.startedAt.trim().length > 0
        ? payload.mission.startedAt
        : phase === 'idle'
          ? undefined
          : current.startedAt;
    const currentWaypointIndex =
      typeof payload?.mission?.currentWaypointIndex === 'number' &&
      Number.isFinite(payload.mission.currentWaypointIndex)
        ? payload.mission.currentWaypointIndex
        : undefined;
    const totalWaypoints =
      typeof payload?.mission?.totalWaypoints === 'number' &&
      Number.isFinite(payload.mission.totalWaypoints)
        ? payload.mission.totalWaypoints
        : current.totalWaypoints;
    const safeUpdatedAt = Math.max(Date.parse(current.updatedAt) || 0, appliedAtMs);

    return setMissionState(
      robotId,
      {
        phase,
        currentMissionId: clearMissionId ? undefined : nextMissionId,
        runId,
        startedAt,
        waypointIndex: clearWaypoint ? undefined : (currentWaypointIndex ?? current.waypointIndex),
        totalWaypoints: clearWaypoint ? undefined : totalWaypoints,
        lastEvent: event,
        lastEventAt: appliedAtMs,
        lastEventMissionId: clearMissionId ? undefined : nextMissionId,
        mode,
        modeUpdatedAt: isRuntimeMode(payload?.mode) ? appliedAtMs : current.modeUpdatedAt,
        batteryPercentage: battery,
        chargingStatus,
        lastSeenTs: appliedAtMs,
        runtimeUpdatedAt: appliedAtMs,
      },
      safeUpdatedAt
    );
  }

  return setMissionState(
    robotId,
    {
      lastEvent: event,
      lastEventAt: appliedAtMs,
    },
    appliedAtMs
  );
};

export const isMissionControlEvent = (event: string) => {
  return MISSION_CONTROL_EVENTS.includes(event as (typeof MISSION_CONTROL_EVENTS)[number]);
};

export const isMissionStatusEvent = (event: string) => {
  return MISSION_STATUS_EVENTS.includes(event as (typeof MISSION_STATUS_EVENTS)[number]);
};

export const buildMissionFailureAck = (event: string, payload: any, message: string) => {
  const missionId = normalizeMissionId(payload?.missionId ?? payload?.missionID);
  const requestId = normalizeRequestId(payload?.requestId);
  const timestamp = nowIso();

  if (event === 'START_MISSION') {
    return {
      event: 'MISSION_START_ACK',
      payload: {
        status: 'failure',
        missionId,
        message,
        timestamp,
        requestId,
        runId: null,
        startedAt: null,
      },
    };
  }

  if (event === 'CHANGE_MODE') {
    return {
      event: 'MODE_CHANGE_ACK',
      payload: {
        status: 'failure',
        currentMode: 'unknown',
        previousMode: 'unknown',
        error: message,
        timestamp,
        requestId,
      },
    };
  }

  return {
    event: 'MISSION_CONTROL_ACK',
    payload: {
      requestType: event,
      status: 'failure',
      missionId,
      message,
      timestamp,
      requestId,
      runId: null,
    },
  };
};
