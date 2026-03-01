export type RobotEmergencyConnectionStatus =
  | 'unconfigured'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

export type RobotEmergencyStatePayload = {
  softwareEmergencyActive: boolean;
  hardwareEmergencyActive: boolean;
  effectiveEmergencyActive: boolean;
  timestamp?: string;
};

export type RobotEmergencyAckPayload = RobotEmergencyStatePayload & {
  status: boolean;
};

export type RobotEmergencyBridgeEvent =
  | { event: 'EMERGENCY_STATE'; payload?: RobotEmergencyStatePayload }
  | { event: 'SOFTWARE_EMERGENCY_ACK'; payload?: RobotEmergencyAckPayload }
  | { event: 'HARDWARE_EMERGENCY_ACK'; payload?: RobotEmergencyAckPayload }
  | { event: string; payload?: unknown };

export type FleetEmergencyDispatchRobotResult = {
  robotId: string;
  robotName?: string | undefined;
  applied: boolean;
  connectionStatus: RobotEmergencyConnectionStatus;
  softwareEmergencyActive: boolean | null;
  hardwareEmergencyActive: boolean | null;
  effectiveEmergencyActive: boolean | null;
  error?: string | null | undefined;
};

export type FleetEmergencyDispatchResult = {
  desiredStatus: boolean;
  status: 'success' | 'partial_failure' | 'failure';
  results: FleetEmergencyDispatchRobotResult[];
  dispatchedAt: string;
  completedAt: string;
};

const EMERGENCY_EVENTS = new Set([
  'EMERGENCY_STATE',
  'SOFTWARE_EMERGENCY_ACK',
  'HARDWARE_EMERGENCY_ACK',
]);

export const isRobotEmergencyEvent = (
  value: unknown
): value is RobotEmergencyBridgeEvent['event'] =>
  typeof value === 'string' && EMERGENCY_EVENTS.has(value);

export const isRobotEmergencyStatePayload = (
  value: unknown
): value is RobotEmergencyStatePayload => {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<RobotEmergencyStatePayload>;
  return (
    typeof payload.softwareEmergencyActive === 'boolean' &&
    typeof payload.hardwareEmergencyActive === 'boolean' &&
    typeof payload.effectiveEmergencyActive === 'boolean'
  );
};

export const isRobotEmergencyAckPayload = (value: unknown): value is RobotEmergencyAckPayload => {
  if (!isRobotEmergencyStatePayload(value)) return false;
  return typeof (value as Partial<RobotEmergencyAckPayload>).status === 'boolean';
};

export const parseRobotEmergencyEvent = (raw: unknown): RobotEmergencyBridgeEvent | null => {
  if (!raw || typeof raw !== 'object') return null;
  const event = (raw as { event?: unknown }).event;
  if (!isRobotEmergencyEvent(event)) return null;
  const payload = (raw as { payload?: unknown }).payload;
  return { event, payload };
};
