export const ROBOT_MISSION_COMMAND_EVENTS = [
  'SHOW_UP',
  'START_MISSION',
  'PAUSE_MISSION',
  'RESUME_MISSION',
  'CANCEL_MISSION',
  'CHANGE_MODE',
] as const;

export type RobotMissionCommandEvent = (typeof ROBOT_MISSION_COMMAND_EVENTS)[number];

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
};

export type RobotMissionEvent =
  | { event: 'MISSION_CONTROL_ACK'; payload?: MissionControlAckPayload }
  | { event: 'MISSION_START_ACK'; payload?: MissionStartAckPayload }
  | { event: 'MISSION_COMPLETED'; payload?: MissionCompletedPayload }
  | { event: 'WAYPOINT_ACK'; payload?: WaypointAckPayload }
  | { event: 'MODE_CHANGE_ACK'; payload?: ModeChangeAckPayload }
  | { event: 'ROBOT_STATUS_UPDATE'; payload?: RobotStatusUpdatePayload }
  | { event: string; payload?: unknown };

const includes = (items: readonly string[], value: unknown): value is string =>
  typeof value === 'string' && items.includes(value);

export const isRobotMissionCommandEvent = (value: unknown): value is RobotMissionCommandEvent =>
  includes(ROBOT_MISSION_COMMAND_EVENTS, value);

export const isRobotMissionStatusEvent = (value: unknown): value is RobotMissionStatusEvent =>
  includes(ROBOT_MISSION_STATUS_EVENTS, value);

export const isRobotRuntimeMode = (value: unknown): value is RobotRuntimeMode =>
  value === 'teleop' || value === 'autonomous';

export const parseRobotMissionEvent = (raw: unknown): RobotMissionEvent | null => {
  if (!raw || typeof raw !== 'object') return null;
  const event = (raw as { event?: unknown }).event;
  if (typeof event !== 'string' || event.trim().length === 0) return null;
  const payload = (raw as { payload?: unknown }).payload;
  return { event, payload };
};
