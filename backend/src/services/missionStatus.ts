import {
  applyMissionEvent,
  applyMissionIntent,
  isMissionActivePhase,
  isRobotMissionStatusEvent,
  type MissionPhase,
  type MissionStatus,
  missionIdOf,
  normalizeMissionId,
  normalizeRequestId,
} from '@tensrai/shared';

export type MissionState = Omit<MissionStatus, 'updatedAt'> & { updatedAt: string };

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
  if (isMissionActivePhase(state.phase)) {
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

const setMissionState = (robotId: string, next: Partial<MissionState>, updatedAtMs = nowMs()) => {
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

// The reducer keeps time in milliseconds; the API has always served updatedAt as an ISO string.
const reduce = (robotId: string, apply: (current: MissionStatus) => MissionStatus) => {
  const stored = getMissionState(robotId);
  const current: MissionStatus = { ...stored, updatedAt: Date.parse(stored.updatedAt) };
  const next = apply(current);
  // The reducer hands back `current` itself when it ignores an event, and nothing is stored then.
  if (next === current) return stored;
  const state: MissionState = {
    ...next,
    updatedAt: new Date(next.updatedAt ?? nowMs()).toISOString(),
  };
  missionStateByRobot.set(robotId, state);
  return state;
};

const persistedRunStatusToPhase = (value: unknown): MissionPhase => {
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

// Only a saved robot event carries the robot's clock; a saved command carries the server's.
const savedRobotEventAt = (
  lastEvent: string | null | undefined,
  lastEventAt: Date | string | null | undefined
) => {
  if (!isRobotMissionStatusEvent(lastEvent) || !lastEventAt) return undefined;
  const ms = Date.parse(String(lastEventAt));
  return Number.isFinite(ms) ? ms : undefined;
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
      lastEventAt: savedRobotEventAt(run.lastEvent, run.lastEventAt),
    },
    Number.isFinite(updatedAtMs) ? updatedAtMs : nowMs()
  );
};

export const recordMissionCommandIntent = (robotId: string, event: string, payload: unknown) =>
  reduce(robotId, current =>
    applyMissionIntent(
      current,
      event,
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {},
      nowMs()
    )
  );

export const updateMissionFromEvent = (
  robotId: string,
  event: string,
  payload: unknown,
  commandId?: string
) => {
  if (!event) return;
  return reduce(robotId, current =>
    applyMissionEvent(current, { event, payload, ...(commandId ? { commandId } : {}) }, nowMs())
  );
};

export const buildMissionFailureAck = (event: string, payload: unknown, message: string) => {
  const missionId = missionIdOf(payload);
  const requestId = normalizeRequestId((payload as { requestId?: unknown } | undefined)?.requestId);
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
