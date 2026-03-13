export const ROBOT_MISSION_COMMAND_EVENTS = [
  'SHOW_UP',
  'START_MISSION',
  'PAUSE_MISSION',
  'RESUME_MISSION',
  'CANCEL_MISSION',
  'CHANGE_MODE',
] as const;

export type RobotMissionCommandEvent = (typeof ROBOT_MISSION_COMMAND_EVENTS)[number];
export type RobotMissionPayload = Record<string, unknown>;

export const ROBOT_MISSION_STATUS_EVENTS = [
  'MISSION_CONTROL_ACK',
  'MISSION_START_ACK',
  'MISSION_COMPLETED',
  'WAYPOINT_ACK',
  'MODE_CHANGE_ACK',
  'ROBOT_STATUS_UPDATE',
] as const;

export type RobotMissionStatusEvent = (typeof ROBOT_MISSION_STATUS_EVENTS)[number];

export type RobotRuntimeMode = 'teleop' | 'autonomous';
export type RobotMissionRuntimeStatus = 'ACTIVE' | 'PAUSED' | 'IDLE';

export type RobotStatusUpdatePayload = {
  robotId?: string | number | null;
  timestamp?: string;
  mode?: RobotRuntimeMode;
  batteryPercentage?: number | null;
  chargingStatus?: string | null;
  mission?: {
    status?: RobotMissionRuntimeStatus;
    currentMissionId?: string | number | null;
    runId?: string | null;
    startedAt?: string | null;
    currentWaypointIndex?: number | null;
    totalWaypoints?: number | null;
  };
};

export type MissionControlAckPayload = {
  requestType?: string;
  status?: string;
  missionId?: string | number | null;
  message?: string;
  timestamp?: string;
  requestId?: string;
  runId?: string | null;
};

export type MissionStartAckPayload = {
  status?: string;
  missionId?: string | number | null;
  message?: string;
  timestamp?: string;
  requestId?: string;
  runId?: string | null;
  startedAt?: string | null;
};

export type MissionCompletedPayload = {
  missionId?: string | number | null;
  status?: string;
  completionTime?: string;
  message?: string;
  runId?: string | null;
};

export type WaypointAckPayload = {
  missionId?: string | number | null;
  waypointIndex?: number;
  totalWaypoints?: number;
  status?: string;
  message?: string;
  time?: string;
  runId?: string | null;
};

export type ModeChangeAckPayload = {
  status?: string;
  currentMode?: RobotRuntimeMode | string;
  previousMode?: RobotRuntimeMode | string;
  error?: string;
  message?: string;
  timestamp?: string;
  time?: string;
  requestId?: string;
};

type RobotMissionFrameBase = {
  commandId?: string;
};

export type RobotMissionCommand = {
  type: 'command';
  event: RobotMissionCommandEvent;
  payload?: RobotMissionPayload;
} & RobotMissionFrameBase;

export type RobotMissionEvent =
  | ({ event: 'MISSION_CONTROL_ACK'; payload?: MissionControlAckPayload } & RobotMissionFrameBase)
  | ({ event: 'MISSION_START_ACK'; payload?: MissionStartAckPayload } & RobotMissionFrameBase)
  | ({ event: 'MISSION_COMPLETED'; payload?: MissionCompletedPayload } & RobotMissionFrameBase)
  | ({ event: 'WAYPOINT_ACK'; payload?: WaypointAckPayload } & RobotMissionFrameBase)
  | ({ event: 'MODE_CHANGE_ACK'; payload?: ModeChangeAckPayload } & RobotMissionFrameBase)
  | ({ event: 'ROBOT_STATUS_UPDATE'; payload?: RobotStatusUpdatePayload } & RobotMissionFrameBase)
  | ({ event: string; payload?: unknown } & RobotMissionFrameBase);

const includes = (items: readonly string[], value: unknown): value is string =>
  typeof value === 'string' && items.includes(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const normalizeOpaqueId = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const next = value.trim();
  return next.length > 0 ? next : undefined;
};

export const isRobotMissionCommandEvent = (value: unknown): value is RobotMissionCommandEvent =>
  includes(ROBOT_MISSION_COMMAND_EVENTS, value);

export const isRobotMissionStatusEvent = (value: unknown): value is RobotMissionStatusEvent =>
  includes(ROBOT_MISSION_STATUS_EVENTS, value);

export const isRobotRuntimeMode = (value: unknown): value is RobotRuntimeMode =>
  value === 'teleop' || value === 'autonomous';

export const extractMissionCommandId = (raw: unknown): string | undefined => {
  if (!isRecord(raw)) return undefined;
  const payload = isRecord(raw['payload']) ? raw['payload'] : undefined;
  return (
    normalizeOpaqueId(raw['commandId']) ??
    normalizeOpaqueId(raw['requestId']) ??
    normalizeOpaqueId(payload?.['requestId'])
  );
};

export const withMissionCommandId = (
  payload: unknown,
  commandId: string | undefined
): RobotMissionPayload | undefined => {
  if (!isRecord(payload)) {
    return commandId ? { requestId: commandId } : undefined;
  }

  const requestId = normalizeOpaqueId(payload['requestId']) ?? commandId;
  if (!requestId || requestId === payload['requestId']) {
    return payload;
  }

  return {
    ...payload,
    requestId,
  };
};

export const parseRobotMissionCommand = (raw: unknown): RobotMissionCommand | null => {
  if (!isRecord(raw)) return null;
  if (raw['type'] !== undefined && raw['type'] !== 'command') return null;

  const event = raw['event'];
  if (!isRobotMissionCommandEvent(event)) return null;

  const commandId = extractMissionCommandId(raw);
  const payload =
    raw['payload'] === undefined
      ? withMissionCommandId(undefined, commandId)
      : withMissionCommandId(raw['payload'], commandId);

  const parsed: RobotMissionCommand = {
    type: 'command',
    event,
  };
  if (payload !== undefined) {
    parsed.payload = payload;
  }
  if (commandId !== undefined) {
    parsed.commandId = commandId;
  }

  return parsed;
};

export const parseRobotMissionEvent = (raw: unknown): RobotMissionEvent | null => {
  if (!isRecord(raw)) return null;
  const event = raw['event'];
  if (typeof event !== 'string' || event.trim().length === 0) return null;
  const commandId = extractMissionCommandId(raw);
  const payload =
    raw['payload'] === undefined
      ? undefined
      : (withMissionCommandId(raw['payload'], commandId) ?? raw['payload']);
  return {
    event,
    ...(payload !== undefined ? { payload } : {}),
    ...(commandId !== undefined ? { commandId } : {}),
  } as RobotMissionEvent;
};
