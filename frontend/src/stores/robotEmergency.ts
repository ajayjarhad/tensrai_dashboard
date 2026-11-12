import type {
  FleetEmergencyDispatchResult,
  RobotEmergencyBridgeEvent,
  RobotEmergencyConnectionStatus,
} from '@tensrai/shared';
import { create } from 'zustand';
import {
  createRobotEmergencyWsClient,
  isEmergencyViaBackend,
} from '@/services/robotEmergencyWsClient';
import type { Robot } from '@/types/robot';

type EmergencyRobotConfig = Pick<Robot, 'id' | 'name' | 'ipAddress' | 'emergencyBridgePort'>;
type KnownEmergencyEventType =
  | 'EMERGENCY_STATE'
  | 'SOFTWARE_EMERGENCY_ACK'
  | 'HARDWARE_EMERGENCY_ACK';

type RobotEmergencyRuntimeState = {
  robotId: string;
  robotName?: string | undefined;
  softwareEmergencyActive: boolean;
  hardwareEmergencyActive: boolean;
  effectiveEmergencyActive: boolean;
  connectionStatus: RobotEmergencyConnectionStatus;
  source: 'live' | 'fallback' | 'unknown';
  updatedAt?: number;
  lastObservedAt?: number;
  lastEventType?: KnownEmergencyEventType;
  lastEventAt?: number;
  lastSoftwareAckAt?: number;
  lastSoftwareAckStatus?: boolean;
};

type PendingDispatch = {
  desiredStatus: boolean;
  startedAt: number;
  robotIds: string[];
};

type EmergencyStoreState = {
  byRobot: Record<string, RobotEmergencyRuntimeState>;
  pendingDispatch: PendingDispatch | null;
  lastDispatchResult: FleetEmergencyDispatchResult | null;
  syncRobots: (robots: EmergencyRobotConfig[]) => void;
  disconnectAll: () => void;
  sendFleetSoftwareEmergency: (desiredStatus: boolean) => Promise<FleetEmergencyDispatchResult>;
};

const DISPATCH_TIMEOUT_MS = Number(import.meta.env['VITE_EMERGENCY_ACK_TIMEOUT_MS'] ?? 5000);
const POLL_MS = 50;
const DEFAULT_EMERGENCY_PORT = 8766;
const USE_BACKEND_EMERGENCY_PROXY = isEmergencyViaBackend();

const clients = new Map<
  string,
  {
    client: ReturnType<typeof createRobotEmergencyWsClient>;
    configKey: string;
  }
>();

const buildConfigKey = (robot: EmergencyRobotConfig) => {
  if (USE_BACKEND_EMERGENCY_PROXY) {
    return `backend:${robot.id}`;
  }
  return `direct:${robot.ipAddress ?? ''}:${robot.emergencyBridgePort ?? DEFAULT_EMERGENCY_PORT}`;
};

const toEventTimestamp = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) return Date.now();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
};

const createBaseState = (
  robot: EmergencyRobotConfig,
  connectionStatus: RobotEmergencyConnectionStatus
): RobotEmergencyRuntimeState => ({
  robotId: robot.id,
  robotName: robot.name,
  softwareEmergencyActive: false,
  hardwareEmergencyActive: false,
  effectiveEmergencyActive: false,
  connectionStatus,
  source: 'unknown',
});

const resolveLegacyEmergencyState = (
  current: RobotEmergencyRuntimeState | undefined,
  event: RobotEmergencyBridgeEvent
): Pick<
  RobotEmergencyRuntimeState,
  'softwareEmergencyActive' | 'hardwareEmergencyActive' | 'effectiveEmergencyActive'
> | null => {
  if (!event.payload || typeof event.payload !== 'object') return null;
  const payload = event.payload as { status?: unknown };
  if (typeof payload.status !== 'boolean') return null;

  const currentHardware = current?.hardwareEmergencyActive ?? false;
  const currentSoftware = current?.softwareEmergencyActive ?? false;

  if (event.event === 'SOFTWARE_EMERGENCY_ACK') {
    return {
      softwareEmergencyActive: payload.status,
      hardwareEmergencyActive: currentHardware,
      effectiveEmergencyActive: payload.status || currentHardware,
    };
  }

  if (event.event === 'HARDWARE_EMERGENCY_ACK') {
    return {
      softwareEmergencyActive: currentSoftware,
      hardwareEmergencyActive: payload.status,
      effectiveEmergencyActive: currentSoftware || payload.status,
    };
  }

  return null;
};

const applyEventToState = (
  current: RobotEmergencyRuntimeState | undefined,
  robotId: string,
  event: RobotEmergencyBridgeEvent,
  lastObservedAt: number
): RobotEmergencyRuntimeState | null => {
  if (!event.payload || typeof event.payload !== 'object') return null;

  const payload = event.payload as {
    softwareEmergencyActive?: unknown;
    hardwareEmergencyActive?: unknown;
    effectiveEmergencyActive?: unknown;
    connectionStatus?: unknown;
    timestamp?: unknown;
  };

  const connectionStatus =
    payload.connectionStatus === 'unconfigured' ||
    payload.connectionStatus === 'connecting' ||
    payload.connectionStatus === 'connected' ||
    payload.connectionStatus === 'disconnected' ||
    payload.connectionStatus === 'error'
      ? payload.connectionStatus
      : 'connected';

  const resolvedState =
    typeof payload.softwareEmergencyActive === 'boolean' &&
    typeof payload.hardwareEmergencyActive === 'boolean' &&
    typeof payload.effectiveEmergencyActive === 'boolean'
      ? {
          softwareEmergencyActive: payload.softwareEmergencyActive,
          hardwareEmergencyActive: payload.hardwareEmergencyActive,
          effectiveEmergencyActive: payload.effectiveEmergencyActive,
        }
      : resolveLegacyEmergencyState(current, event);

  if (!resolvedState) return null;

  const eventAt = toEventTimestamp(payload.timestamp);
  const isSoftwareAck = event.event === 'SOFTWARE_EMERGENCY_ACK';
  const ackStatus =
    typeof (event.payload as { status?: unknown }).status === 'boolean'
      ? ((event.payload as { status: boolean }).status as boolean)
      : resolvedState.softwareEmergencyActive;

  return {
    robotId,
    robotName: current?.robotName,
    softwareEmergencyActive: resolvedState.softwareEmergencyActive,
    hardwareEmergencyActive: resolvedState.hardwareEmergencyActive,
    effectiveEmergencyActive: resolvedState.effectiveEmergencyActive,
    connectionStatus,
    source: 'live',
    updatedAt: eventAt,
    lastObservedAt,
    lastEventType: event.event as KnownEmergencyEventType,
    lastEventAt: lastObservedAt,
    ...(isSoftwareAck
      ? {
          lastSoftwareAckAt: lastObservedAt,
          lastSoftwareAckStatus: ackStatus,
        }
      : {}),
  };
};

const toDisconnectedState = (
  robot: EmergencyRobotConfig,
  current?: RobotEmergencyRuntimeState
): RobotEmergencyRuntimeState => ({
  ...(current ?? createBaseState(robot, 'disconnected')),
  robotName: robot.name,
  softwareEmergencyActive: false,
  hardwareEmergencyActive: false,
  effectiveEmergencyActive: false,
  connectionStatus: 'disconnected',
  source: 'unknown',
});

const toStatusChangeState = (
  robot: EmergencyRobotConfig,
  status: RobotEmergencyConnectionStatus,
  current?: RobotEmergencyRuntimeState
): RobotEmergencyRuntimeState => {
  if (status === 'connected') {
    return {
      ...(current ?? createBaseState(robot, status)),
      robotName: robot.name,
      connectionStatus: status,
      source: current?.source ?? 'unknown',
    };
  }

  return {
    ...(current ?? createBaseState(robot, status)),
    robotName: robot.name,
    softwareEmergencyActive: false,
    hardwareEmergencyActive: false,
    effectiveEmergencyActive: false,
    connectionStatus: status,
    source: 'unknown',
  };
};

type RobotAckResult = {
  robotId: string;
  robotName?: string | undefined;
  applied: boolean;
  connectionStatus: RobotEmergencyConnectionStatus;
  softwareEmergencyActive: boolean | null;
  hardwareEmergencyActive: boolean | null;
  effectiveEmergencyActive: boolean | null;
  error: string | null;
};

const toAckResult = (
  robotId: string,
  state: RobotEmergencyRuntimeState | undefined,
  applied: boolean,
  error: string | null
): RobotAckResult => ({
  robotId,
  ...(state?.robotName ? { robotName: state.robotName } : {}),
  applied,
  connectionStatus: state?.connectionStatus ?? 'unconfigured',
  softwareEmergencyActive: state?.softwareEmergencyActive ?? null,
  hardwareEmergencyActive: state?.hardwareEmergencyActive ?? null,
  effectiveEmergencyActive: state?.effectiveEmergencyActive ?? null,
  error,
});

const hasMatchingAck = (
  state: RobotEmergencyRuntimeState | undefined,
  desiredStatus: boolean,
  startedAt: number
) =>
  state?.connectionStatus === 'connected' &&
  typeof state.lastSoftwareAckAt === 'number' &&
  state.lastSoftwareAckAt >= startedAt &&
  state.lastSoftwareAckStatus === desiredStatus;

const waitForAck = (
  getState: () => EmergencyStoreState,
  robotId: string,
  desiredStatus: boolean,
  startedAt: number,
  immediateFailure?: string
) =>
  new Promise<RobotAckResult>(resolve => {
    const deadline = Date.now() + DISPATCH_TIMEOUT_MS;

    const tick = () => {
      const state = getState().byRobot[robotId];
      if (immediateFailure) {
        resolve(toAckResult(robotId, state, false, immediateFailure));
        return;
      }

      if (hasMatchingAck(state, desiredStatus, startedAt)) {
        resolve(toAckResult(robotId, state, true, null));
        return;
      }

      if (Date.now() >= deadline) {
        resolve(
          toAckResult(robotId, state, false, 'No matching emergency acknowledgment received')
        );
        return;
      }

      window.setTimeout(tick, POLL_MS);
    };

    tick();
  });

type EmergencySet = (
  updater: (state: EmergencyStoreState) => Partial<EmergencyStoreState> | EmergencyStoreState
) => void;

// Unregistered before it is disconnected, so the status change its disconnect reports cannot
// write a removed robot back into the store.
const retireClient = (robotId: string) => {
  const entry = clients.get(robotId);
  clients.delete(robotId);
  entry?.client.disconnect();
};

// Keeps a robot's bridge client, replacing it only when the robot's bridge address changed.
const ensureEmergencyClient = (robot: EmergencyRobotConfig, set: EmergencySet) => {
  const configKey = buildConfigKey(robot);
  const existing = clients.get(robot.id);
  if (existing && existing.configKey === configKey) return;

  retireClient(robot.id);
  const client = createRobotEmergencyWsClient({
    robotId: robot.id,
    robotName: robot.name,
    ...(robot.ipAddress ? { ipAddress: robot.ipAddress } : {}),
    ...(robot.emergencyBridgePort ? { emergencyBridgePort: robot.emergencyBridgePort } : {}),
  });
  const isCurrent = () => clients.get(robot.id)?.client === client;

  client.addStatusListener(status => {
    if (!isCurrent()) return;
    set(store => {
      const currentState = store.byRobot[robot.id];
      return {
        byRobot: {
          ...store.byRobot,
          [robot.id]: toStatusChangeState(robot, status, currentState),
        },
      };
    });
  });

  client.addEventListener(event => {
    if (!isCurrent()) return;
    const observedAt = Date.now();
    set(store => {
      const currentState = store.byRobot[robot.id];
      const nextState = applyEventToState(currentState, robot.id, event, observedAt);
      if (!nextState) return store;
      return {
        byRobot: {
          ...store.byRobot,
          [robot.id]: {
            ...currentState,
            ...nextState,
            robotName: robot.name,
          },
        },
      };
    });
  });

  clients.set(robot.id, { client, configKey });
  client.connect();
};

const toSyncedState = (
  robot: EmergencyRobotConfig,
  current: RobotEmergencyRuntimeState | undefined
): RobotEmergencyRuntimeState => ({
  ...(current ?? toDisconnectedState(robot)),
  robotName: robot.name,
  connectionStatus:
    (clients.get(robot.id)?.client.getStatus() as RobotEmergencyConnectionStatus) ??
    current?.connectionStatus ??
    'disconnected',
});

const disconnectRemovedClients = (keptIds: Set<string>) => {
  for (const robotId of Array.from(clients.keys())) {
    if (!keptIds.has(robotId)) retireClient(robotId);
  }
};

// Robots that cannot be sent the command fail at once instead of waiting out the ack timeout.
const sendToEachRobot = (
  getState: () => EmergencyStoreState,
  robotIds: string[],
  desiredStatus: boolean
) => {
  const immediateFailures = new Map<string, string>();
  for (const robotId of robotIds) {
    const entry = clients.get(robotId);
    const robotState = getState().byRobot[robotId];
    if (!entry || robotState?.connectionStatus !== 'connected' || !entry.client.isOpen()) {
      immediateFailures.set(
        robotId,
        robotState?.connectionStatus === 'unconfigured'
          ? 'Emergency bridge not configured'
          : 'Emergency bridge not connected'
      );
      continue;
    }

    const accepted = entry.client.sendSoftwareEmergency(desiredStatus);
    if (!accepted) {
      immediateFailures.set(robotId, 'Failed to send emergency command');
    }
  }
  return immediateFailures;
};

const dispatchStatus = (
  successCount: number,
  total: number
): FleetEmergencyDispatchResult['status'] => {
  if (successCount === total) return 'success';
  if (successCount === 0) return 'failure';
  return 'partial_failure';
};

export const useRobotEmergencyStore = create<EmergencyStoreState>((set, get) => ({
  byRobot: {},
  pendingDispatch: null,
  lastDispatchResult: null,

  syncRobots: robots => {
    const nextIds = new Set(robots.map(robot => robot.id));
    const nextByRobot = { ...get().byRobot };

    for (const robot of robots) {
      const current = nextByRobot[robot.id];
      const hasSocketConfig = USE_BACKEND_EMERGENCY_PROXY || Boolean(robot.ipAddress);

      if (!hasSocketConfig) {
        retireClient(robot.id);
        nextByRobot[robot.id] = toStatusChangeState(robot, 'unconfigured', current);
        continue;
      }

      ensureEmergencyClient(robot, set);
      nextByRobot[robot.id] = toSyncedState(robot, current);
    }

    for (const robotId of Object.keys(nextByRobot)) {
      if (nextIds.has(robotId)) continue;
      delete nextByRobot[robotId];
    }

    set({ byRobot: nextByRobot });
    disconnectRemovedClients(nextIds);
  },

  disconnectAll: () => {
    for (const robotId of Array.from(clients.keys())) retireClient(robotId);
    set({
      byRobot: {},
      pendingDispatch: null,
    });
  },

  sendFleetSoftwareEmergency: async desiredStatus => {
    const startedAt = Date.now();
    const currentState = get();
    const robotIds = Object.keys(currentState.byRobot);

    set({
      pendingDispatch: {
        desiredStatus,
        startedAt,
        robotIds,
      },
    });

    const immediateFailures = sendToEachRobot(get, robotIds, desiredStatus);
    const results = await Promise.all(
      robotIds.map(robotId =>
        waitForAck(get, robotId, desiredStatus, startedAt, immediateFailures.get(robotId))
      )
    );

    const successCount = results.filter(result => result.applied).length;

    const result: FleetEmergencyDispatchResult = {
      desiredStatus,
      status: dispatchStatus(successCount, results.length),
      results,
      dispatchedAt: new Date(startedAt).toISOString(),
      completedAt: new Date().toISOString(),
    };

    set(state => ({
      lastDispatchResult: result,
      pendingDispatch:
        state.pendingDispatch?.startedAt === startedAt ? null : state.pendingDispatch,
    }));

    return result;
  },
}));
