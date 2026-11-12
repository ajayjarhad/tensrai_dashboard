import {
  extractMissionCommandId,
  isRobotRuntimeMode,
  type MissionCompletedPayload,
  type MissionControlAckPayload,
  type MissionStartAckPayload,
  type ModeChangeAckPayload,
  type RobotMissionEvent,
  type RobotRuntimeMode,
  type RobotStatusUpdatePayload,
  type WaypointAckPayload,
} from '../types/robot-ws.js';

export type MissionPhase =
  | 'idle'
  | 'preview_pending'
  | 'showing'
  | 'start_pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type MissionStatus = {
  status: MissionPhase;
  phase: MissionPhase;
  currentMissionId?: string | undefined;
  requestIdLast?: string | undefined;
  runId?: string | undefined;
  startedAt?: string | undefined;
  message?: string | undefined;
  updatedAt?: number | undefined;
  lastEvent?: string | undefined;
  lastEventStatus?: string | undefined;
  lastRequestType?: string | undefined;
  lastEventAt?: number | undefined;
  lastCommandAt?: number | undefined;
  lastEventMissionId?: string | undefined;
  mode?: RobotRuntimeMode | undefined;
  batteryPercentage?: number | null | undefined;
  chargingStatus?: string | null | undefined;
  lastSeenTs?: number | undefined;
  waypointIndex?: number | undefined;
  totalWaypoints?: number | undefined;
  runtimeUpdatedAt?: number | undefined;
  modeUpdatedAt?: number | undefined;
};

export const isMissionActivePhase = (phase: string | undefined) =>
  phase === 'running' || phase === 'paused' || phase === 'showing' || phase === 'start_pending';

export const isPreviewLikePhase = (phase: string | undefined) =>
  phase === 'preview_pending' || phase === 'showing' || phase === 'start_pending';

export const normalizeMissionId = (value: unknown): string | undefined => {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const str = String(value).trim();
  return str.length ? str : undefined;
};

export const normalizeRequestId = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const str = value.trim();
  return str.length ? str : undefined;
};

export const normalizeRequestType = (value: unknown) => {
  if (!value) return undefined;
  const raw = String(value).trim().toUpperCase();
  if (raw === 'PAUSE_MISSION' || raw === 'PAUSE') return 'PAUSE';
  if (raw === 'RESUME_MISSION' || raw === 'RESUME') return 'RESUME';
  if (raw === 'CANCEL_MISSION' || raw === 'CANCEL') return 'CANCEL';
  if (raw === 'START_MISSION') return 'START_MISSION';
  if (raw === 'SHOW_UP') return 'SHOW_UP';
  return raw;
};

const fieldOf = (payload: unknown, key: string): unknown =>
  payload && typeof payload === 'object' ? (payload as Record<string, unknown>)[key] : undefined;

// Robots send missionId; missionID is still accepted, as the saved mission runs do.
export const missionIdOf = (payload: unknown) =>
  normalizeMissionId(fieldOf(payload, 'missionId') ?? fieldOf(payload, 'missionID'));

const parseTimestampMs = (value: unknown): number | undefined => {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const validTimestamp = (value: string | null | undefined) =>
  parseTimestampMs(value) === undefined ? undefined : (value as string);

const textOr = <T>(value: unknown, fallback: T) => (typeof value === 'string' ? value : fallback);

const toFiniteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const eventTimestamp = (event: string, payload: unknown, nowMs: number): number => {
  if (event === 'ROBOT_STATUS_UPDATE')
    return parseTimestampMs(fieldOf(payload, 'timestamp')) ?? nowMs;
  if (event === 'WAYPOINT_ACK') return parseTimestampMs(fieldOf(payload, 'time')) ?? nowMs;
  if (event === 'MISSION_COMPLETED') {
    return parseTimestampMs(fieldOf(payload, 'completionTime')) ?? nowMs;
  }
  return (
    parseTimestampMs(fieldOf(payload, 'timestamp')) ??
    parseTimestampMs(fieldOf(payload, 'time')) ??
    nowMs
  );
};

const fromRuntimeMissionStatus = (value: unknown): MissionPhase | undefined => {
  const status = String(value ?? '').toUpperCase();
  if (status === 'ACTIVE') return 'running';
  if (status === 'PAUSED') return 'paused';
  if (status === 'IDLE') return 'idle';
  return undefined;
};

// A completion or waypoint from another run must not touch the current one.
const isOtherRun = (current: MissionStatus, eventRunId: string | undefined) =>
  !!eventRunId && !!current.runId && eventRunId !== current.runId;

const shouldAcceptRequest = (
  current: MissionStatus,
  requestId: string | undefined,
  eventAt: number
) => {
  if (!requestId || !current.requestIdLast) return true;
  if (requestId === current.requestIdLast) return true;
  return (current.lastEventAt ?? 0) <= eventAt;
};

const withPhase = (base: MissionStatus, phase: MissionPhase): MissionStatus => ({
  ...base,
  phase,
  status: phase,
});

const applyStartAck = (
  current: MissionStatus,
  payload: MissionStartAckPayload | undefined,
  base: MissionStatus,
  commandId: string | undefined
): MissionStatus => {
  const missionId = missionIdOf(payload);
  const requestId = normalizeRequestId(payload?.requestId ?? commandId);
  if (!shouldAcceptRequest(current, requestId, base.lastEventAt ?? 0)) return current;
  const ackStatus = payload?.status;
  const shared = {
    ...base,
    currentMissionId: missionId ?? current.currentMissionId,
    requestIdLast: requestId ?? current.requestIdLast,
    lastEventMissionId: missionId ?? current.currentMissionId,
    message: textOr(payload?.message, current.message),
    lastEventStatus: ackStatus,
  };

  if (ackStatus === 'success') {
    if (!missionId && !current.currentMissionId) return current;
    return withPhase(
      {
        ...shared,
        runId: normalizeRequestId(payload?.runId) ?? current.runId,
        startedAt: validTimestamp(payload?.startedAt) ?? current.startedAt,
        waypointIndex: 0,
      },
      'running'
    );
  }

  return withPhase(shared, current.phase === 'start_pending' ? 'showing' : current.phase);
};

const unlessCleared = <T>(cleared: boolean, value: T) => (cleared ? undefined : value);

const phaseAfterSucceededControl = (requestType: string | undefined): MissionPhase | undefined => {
  if (requestType === 'SHOW_UP') return 'showing';
  if (requestType === 'PAUSE') return 'paused';
  if (requestType === 'RESUME') return 'running';
  if (requestType === 'CANCEL') return 'cancelled';
  return undefined;
};

const phaseAfterControlAck = (
  currentPhase: MissionPhase,
  requestType: string | undefined,
  succeeded: boolean
): MissionPhase => {
  if (succeeded) return phaseAfterSucceededControl(requestType) ?? currentPhase;
  if (requestType === 'SHOW_UP' && currentPhase === 'preview_pending') return 'idle';
  return currentPhase;
};

const applyControlAck = (
  current: MissionStatus,
  payload: MissionControlAckPayload | undefined,
  base: MissionStatus,
  commandId: string | undefined
): MissionStatus => {
  const requestType = normalizeRequestType(payload?.requestType);
  const requestId = normalizeRequestId(payload?.requestId ?? commandId);
  if (!shouldAcceptRequest(current, requestId, base.lastEventAt ?? 0)) return current;
  const missionId = missionIdOf(payload);
  const ackStatus = payload?.status;
  const succeeded = ackStatus === 'success';
  const clearMission = succeeded && requestType === 'CANCEL';
  const clearWaypoint = succeeded && (requestType === 'SHOW_UP' || requestType === 'CANCEL');

  return withPhase(
    {
      ...base,
      currentMissionId: unlessCleared(clearMission, missionId ?? current.currentMissionId),
      requestIdLast: requestId ?? current.requestIdLast,
      runId: unlessCleared(clearMission, current.runId),
      startedAt: unlessCleared(clearMission, current.startedAt),
      waypointIndex: unlessCleared(clearWaypoint, current.waypointIndex),
      totalWaypoints: unlessCleared(clearWaypoint, current.totalWaypoints),
      lastEventMissionId: missionId ?? current.currentMissionId,
      message: textOr(payload?.message, current.message),
      lastEventStatus: ackStatus,
      lastRequestType: requestType,
    },
    phaseAfterControlAck(current.phase, requestType, succeeded)
  );
};

const applyCompleted = (
  current: MissionStatus,
  payload: MissionCompletedPayload | undefined,
  base: MissionStatus
): MissionStatus => {
  const runId = normalizeRequestId(payload?.runId);
  if (isOtherRun(current, runId)) return current;
  const rawStatus = String(payload?.status ?? '').toLowerCase();
  const missionId = missionIdOf(payload);
  const phase: MissionPhase =
    rawStatus === 'success' ? 'completed' : rawStatus === 'cancelled' ? 'cancelled' : 'failed';

  return withPhase(
    {
      ...base,
      currentMissionId: missionId ?? current.currentMissionId,
      runId: runId ?? current.runId,
      lastEventMissionId: missionId ?? current.currentMissionId,
      message: textOr(payload?.message, current.message),
      lastEventStatus: rawStatus,
    },
    phase
  );
};

const applyWaypointAck = (
  current: MissionStatus,
  payload: WaypointAckPayload | undefined,
  base: MissionStatus
): MissionStatus => {
  const runId = normalizeRequestId(payload?.runId);
  if (isOtherRun(current, runId)) return current;
  const missionId = missionIdOf(payload);
  return {
    ...base,
    currentMissionId: missionId ?? current.currentMissionId,
    runId: runId ?? current.runId,
    waypointIndex: toFiniteNumber(payload?.waypointIndex) ?? current.waypointIndex,
    totalWaypoints: toFiniteNumber(payload?.totalWaypoints) ?? current.totalWaypoints,
    lastEventMissionId: missionId ?? current.currentMissionId,
    message: textOr(payload?.message, current.message),
    lastEventStatus: textOr(payload?.status, current.lastEventStatus),
  };
};

const applyModeChangeAck = (
  current: MissionStatus,
  payload: ModeChangeAckPayload | undefined,
  base: MissionStatus,
  commandId: string | undefined
): MissionStatus => {
  const requestId = normalizeRequestId(payload?.requestId ?? commandId);
  return {
    ...base,
    mode: isRobotRuntimeMode(payload?.currentMode) ? payload.currentMode : current.mode,
    modeUpdatedAt:
      parseTimestampMs(payload?.timestamp) ??
      parseTimestampMs(payload?.time) ??
      current.modeUpdatedAt,
    message: textOr(payload?.message, textOr(payload?.error, current.message)),
    lastEventStatus: textOr(payload?.status, current.lastEventStatus),
    requestIdLast: requestId ?? current.requestIdLast,
  };
};

type RuntimeMissionReport = RobotStatusUpdatePayload['mission'];

type ReportedMission = {
  phase: MissionPhase | undefined;
  missionId: string | undefined;
  runId: string | undefined;
  namesMission: boolean;
};

const readReportedMission = (mission: RuntimeMissionReport): ReportedMission => ({
  phase: fromRuntimeMissionStatus(mission?.status),
  missionId: normalizeMissionId(mission?.currentMissionId),
  runId: normalizeRequestId(mission?.runId),
  namesMission:
    mission !== undefined && mission !== null && Object.hasOwn(mission, 'currentMissionId'),
});

// A robot reports IDLE throughout a preview, so only a report naming a mission or run ends it.
const keepsPreview = (current: MissionStatus, reported: ReportedMission) =>
  isPreviewLikePhase(current.phase) &&
  reported.phase === 'idle' &&
  !reported.missionId &&
  !reported.runId;

const missionIdFromReport = (
  current: MissionStatus,
  reported: ReportedMission,
  keepPreview: boolean
) => {
  if (!keepPreview && reported.phase === 'idle' && !reported.namesMission) return undefined;
  return keepPreview || !reported.namesMission ? current.currentMissionId : reported.missionId;
};

const reportedStartedAt = (mission: RuntimeMissionReport) =>
  typeof mission?.startedAt === 'string' && mission.startedAt.trim().length > 0
    ? mission.startedAt
    : undefined;

const runFromReport = (
  current: MissionStatus,
  mission: RuntimeMissionReport,
  reported: ReportedMission,
  nextPhase: MissionPhase
) => {
  const ended = nextPhase === 'idle';
  return {
    runId: reported.runId ?? (ended ? undefined : current.runId),
    startedAt: reportedStartedAt(mission) ?? (ended ? undefined : current.startedAt),
  };
};

const waypointsFromReport = (
  current: MissionStatus,
  mission: RuntimeMissionReport,
  reported: ReportedMission,
  nextPhase: MissionPhase
) => {
  const missionChanged = reported.namesMission && reported.missionId !== current.currentMissionId;
  if (missionChanged || !isMissionActivePhase(nextPhase)) {
    return { waypointIndex: undefined, totalWaypoints: undefined };
  }
  return {
    waypointIndex: toFiniteNumber(mission?.currentWaypointIndex) ?? current.waypointIndex,
    totalWaypoints: toFiniteNumber(mission?.totalWaypoints) ?? current.totalWaypoints,
  };
};

const powerFromReport = (current: MissionStatus, payload: RobotStatusUpdatePayload | undefined) => {
  const battery = payload?.batteryPercentage;
  const charging = payload?.chargingStatus;
  return {
    batteryPercentage:
      toFiniteNumber(battery) ?? (battery === null ? null : current.batteryPercentage),
    chargingStatus: textOr(charging, charging === null ? null : current.chargingStatus),
  };
};

// Status reports run on their own clock, so a command or ack stamped by a different clock can
// never make the robot's own report look stale.
const applyStatusUpdate = (
  current: MissionStatus,
  payload: RobotStatusUpdatePayload | undefined,
  eventAt: number
): MissionStatus => {
  if (current.runtimeUpdatedAt !== undefined && eventAt < current.runtimeUpdatedAt) {
    return current;
  }

  const mission = payload?.mission;
  const reported = readReportedMission(mission);
  const keepPreview = keepsPreview(current, reported);
  const nextPhase = keepPreview ? current.phase : (reported.phase ?? current.phase);
  const reportedMode = isRobotRuntimeMode(payload?.mode) ? payload.mode : undefined;

  return withPhase(
    {
      ...current,
      currentMissionId: missionIdFromReport(current, reported, keepPreview),
      ...(keepPreview
        ? { runId: current.runId, startedAt: current.startedAt }
        : runFromReport(current, mission, reported, nextPhase)),
      ...waypointsFromReport(current, mission, reported, nextPhase),
      mode: reportedMode ?? current.mode,
      ...powerFromReport(current, payload),
      lastSeenTs: eventAt,
      runtimeUpdatedAt: eventAt,
      modeUpdatedAt: reportedMode ? eventAt : current.modeUpdatedAt,
      updatedAt: Math.max(current.updatedAt ?? 0, eventAt),
    },
    nextPhase
  );
};

export const applyMissionEvent = (
  current: MissionStatus,
  event: RobotMissionEvent,
  nowMs: number
): MissionStatus => {
  const eventAt = eventTimestamp(event.event, event.payload, nowMs);
  if (event.event === 'ROBOT_STATUS_UPDATE') {
    return applyStatusUpdate(current, event.payload as RobotStatusUpdatePayload, eventAt);
  }
  if (current.lastEventAt !== undefined && eventAt < current.lastEventAt) return current;

  const commandId = extractMissionCommandId(event);
  const base: MissionStatus = {
    ...current,
    lastEvent: event.event,
    lastEventAt: eventAt,
    updatedAt: eventAt,
  };

  switch (event.event) {
    case 'MISSION_START_ACK':
      return applyStartAck(current, event.payload as MissionStartAckPayload, base, commandId);
    case 'MISSION_CONTROL_ACK':
      return applyControlAck(current, event.payload as MissionControlAckPayload, base, commandId);
    case 'MISSION_COMPLETED':
      return applyCompleted(current, event.payload as MissionCompletedPayload, base);
    case 'WAYPOINT_ACK':
      return applyWaypointAck(current, event.payload as WaypointAckPayload, base);
    case 'MODE_CHANGE_ACK':
      return applyModeChangeAck(current, event.payload as ModeChangeAckPayload, base, commandId);
    default:
      return base;
  }
};

const MISSION_INTENTS = new Set([
  'SHOW_UP',
  'START_MISSION',
  'PAUSE_MISSION',
  'RESUME_MISSION',
  'CANCEL_MISSION',
]);

// Commands that don't change the mission, such as a mode change, are not recorded.
export const applyMissionIntent = (
  current: MissionStatus,
  event: string,
  payload: Record<string, unknown>,
  nowMs: number,
  commandId?: string
): MissionStatus => {
  if (!MISSION_INTENTS.has(event)) return current;
  const missionId = missionIdOf(payload);
  // lastEventAt is the robot's clock, which robot events are ordered by. A command is stamped by
  // this machine's clock, so writing it there would drop events from a robot whose clock lags.
  const base: MissionStatus = {
    ...current,
    lastEvent: event,
    lastCommandAt: nowMs,
    updatedAt: nowMs,
    lastEventMissionId: missionId ?? current.currentMissionId,
    lastEventStatus: 'pending',
    lastRequestType: normalizeRequestType(event),
    requestIdLast: normalizeRequestId(commandId ?? payload['requestId']),
  };

  if (event === 'SHOW_UP') {
    return withPhase(
      {
        ...base,
        currentMissionId: missionId,
        runId: undefined,
        startedAt: undefined,
        waypointIndex: undefined,
        totalWaypoints: undefined,
        message: 'SHOW_UP sent… waiting for robot',
      },
      'preview_pending'
    );
  }

  if (event === 'START_MISSION') {
    return withPhase(
      {
        ...base,
        currentMissionId: missionId ?? current.currentMissionId,
        message: 'Starting… waiting for robot ack',
      },
      // The robot refuses a second start, and that refusal must not read as a lost mission.
      current.phase === 'running' || current.phase === 'paused' ? current.phase : 'start_pending'
    );
  }

  return base;
};
