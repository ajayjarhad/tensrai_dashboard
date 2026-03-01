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

export type MissionStateStatus =
  | 'idle'
  | 'showing'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type MissionState = {
  status: MissionStateStatus;
  currentMissionId?: string | undefined;
  lastEvent?: string | undefined;
  message?: string | undefined;
  updatedAt: string;
  lastEventStatus?: string | undefined;
  lastRequestType?: string | undefined;
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

export const getMissionState = (robotId: string): MissionState => {
  return (
    missionStateByRobot.get(robotId) ?? {
      status: 'idle',
      updatedAt: nowIso(),
    }
  );
};

export const deriveRobotModeFromMissionState = (
  robotId: string
): 'MISSION' | 'TELEOP' | undefined => {
  const state = getMissionState(robotId);
  if (state.status === 'running' || state.status === 'paused' || state.status === 'showing') {
    return 'MISSION';
  }
  if (state.mode === 'teleop') {
    return 'TELEOP';
  }
  return undefined;
};

export const setMissionState = (
  robotId: string,
  next: Partial<MissionState>,
  updatedAtMs = Date.now()
) => {
  const current = getMissionState(robotId);
  const safeMs = Number.isFinite(updatedAtMs) ? updatedAtMs : Date.now();
  const merged: MissionState = {
    ...current,
    ...next,
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

const normalizeRequestType = (value: unknown): string | undefined => {
  if (!value) return undefined;
  const raw = String(value).trim().toUpperCase();
  if (raw === 'PAUSE_MISSION' || raw === 'PAUSE') return 'PAUSE';
  if (raw === 'RESUME_MISSION' || raw === 'RESUME') return 'RESUME';
  if (raw === 'CANCEL_MISSION' || raw === 'CANCEL') return 'CANCEL';
  if (raw === 'SHOW_UP') return 'SHOW_UP';
  return raw;
};

const missionStatusFromRuntime = (value: unknown): MissionStateStatus | undefined => {
  const status = String(value ?? '').toUpperCase();
  if (status === 'ACTIVE') return 'running';
  if (status === 'PAUSED') return 'paused';
  if (status === 'IDLE') return 'idle';
  return undefined;
};

const shouldKeepWaypointProgress = (status: MissionStateStatus | undefined) =>
  status === 'running' || status === 'paused' || status === 'showing';

const timestampMs = (value: unknown): number | undefined => {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const eventTimestampMs = (event: string, payload: any): number => {
  if (event === 'ROBOT_STATUS_UPDATE') {
    return timestampMs(payload?.timestamp) ?? Date.now();
  }
  if (event === 'WAYPOINT_ACK') {
    return timestampMs(payload?.time) ?? Date.now();
  }
  if (event === 'MISSION_COMPLETED') {
    return timestampMs(payload?.completionTime) ?? Date.now();
  }
  return timestampMs(payload?.timestamp) ?? timestampMs(payload?.time) ?? Date.now();
};

const shouldApplyEvent = (current: MissionState, nextTimestampMs: number) => {
  const currentTs = Date.parse(current.updatedAt);
  if (!Number.isFinite(currentTs)) return true;
  return nextTimestampMs >= currentTs;
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
    const message = typeof payload?.message === 'string' ? payload.message : current.message;
    const status =
      ackStatus === 'success'
        ? 'running'
        : current.status === 'running' ||
            current.status === 'paused' ||
            current.status === 'showing'
          ? current.status
          : 'idle';

    return setMissionState(
      robotId,
      {
        status,
        currentMissionId: missionId,
        waypointIndex: ackStatus === 'success' ? 0 : undefined,
        totalWaypoints: undefined,
        lastEvent: event,
        lastEventStatus: ackStatus,
        message,
      },
      appliedAtMs
    );
  }

  if (event === 'MISSION_CONTROL_ACK') {
    const requestType = normalizeRequestType(payload?.requestType);
    const ackStatus = typeof payload?.status === 'string' ? payload.status : undefined;
    const missionId = normalizeMissionId(payload?.missionId ?? payload?.missionID);
    const message = typeof payload?.message === 'string' ? payload.message : current.message;

    let status = current.status;
    if (ackStatus === 'success') {
      if (requestType === 'SHOW_UP') status = 'showing';
      if (requestType === 'PAUSE') status = 'paused';
      if (requestType === 'RESUME') status = 'running';
      if (requestType === 'CANCEL') status = 'cancelled';
    }
    const nextMissionId =
      ackStatus === 'success' && requestType === 'CANCEL'
        ? undefined
        : (missionId ?? current.currentMissionId);
    const clearWaypoint =
      (ackStatus === 'success' && requestType === 'SHOW_UP') ||
      (ackStatus === 'success' && requestType === 'CANCEL');

    return setMissionState(
      robotId,
      {
        status,
        currentMissionId: nextMissionId,
        waypointIndex: clearWaypoint ? undefined : current.waypointIndex,
        totalWaypoints: clearWaypoint ? undefined : current.totalWaypoints,
        lastEvent: event,
        lastEventStatus: ackStatus,
        lastRequestType: requestType,
        message,
      },
      appliedAtMs
    );
  }

  if (event === 'MISSION_COMPLETED') {
    const rawStatus = String(payload?.status ?? '').toLowerCase();
    const missionId = normalizeMissionId(payload?.missionId ?? payload?.missionID);
    const resolvedStatus: MissionStateStatus =
      rawStatus === 'success' ? 'completed' : rawStatus === 'cancelled' ? 'cancelled' : 'failed';
    const message = typeof payload?.message === 'string' ? payload.message : current.message;
    return setMissionState(
      robotId,
      {
        status: resolvedStatus,
        currentMissionId: missionId ?? current.currentMissionId,
        lastEvent: event,
        lastEventStatus: rawStatus,
        message,
      },
      appliedAtMs
    );
  }

  if (event === 'WAYPOINT_ACK') {
    const missionId = normalizeMissionId(payload?.missionId ?? payload?.missionID);
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
        lastEvent: event,
        lastEventStatus: ackStatus,
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
        message,
      },
      appliedAtMs
    );
  }

  if (event === 'ROBOT_STATUS_UPDATE') {
    if (current.runtimeUpdatedAt !== undefined && appliedAtMs < current.runtimeUpdatedAt) {
      return current;
    }

    const missionStatus = missionStatusFromRuntime(payload?.mission?.status);
    const missionId = normalizeMissionId(payload?.mission?.currentMissionId);
    const hasMissionId =
      payload?.mission !== undefined &&
      payload?.mission !== null &&
      Object.hasOwn(payload.mission, 'currentMissionId');
    const nextStatus = missionStatus ?? current.status;
    const nextMissionId = hasMissionId ? missionId : current.currentMissionId;
    const clearMissionId = missionStatus === 'idle' && !hasMissionId;
    const missionChanged = hasMissionId && missionId !== current.currentMissionId;
    const clearWaypoint = missionChanged || !shouldKeepWaypointProgress(nextStatus);
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
    const safeUpdatedAt = Math.max(Date.parse(current.updatedAt) || 0, appliedAtMs);

    return setMissionState(
      robotId,
      {
        status: nextStatus,
        currentMissionId: clearMissionId ? undefined : nextMissionId,
        waypointIndex: clearWaypoint ? undefined : current.waypointIndex,
        totalWaypoints: clearWaypoint ? undefined : current.totalWaypoints,
        lastEvent: event,
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

  if (event === 'START_MISSION') {
    return {
      event: 'MISSION_START_ACK',
      payload: {
        status: 'failure',
        missionId,
        message,
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
    },
  };
};
