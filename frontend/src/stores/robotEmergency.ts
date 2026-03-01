import type {
  FleetEmergencyDispatchResult,
  RobotEmergencyBridgeEvent,
  RobotEmergencyConnectionStatus,
} from '@tensrai/shared';
import { create } from 'zustand';
import { createRobotEmergencyWsClient } from '@/services/robotEmergencyWsClient';
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
  updatedAt?: number;
  lastObservedAt?: number;
  lastEventType?: KnownEmergencyEventType;
  lastEventAt?: number;
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

const DEFAULT_EMERGENCY_PORT = 8766;
const DISPATCH_TIMEOUT_MS = 2_000;

const clients = new Map<
  string,
  {
    client: ReturnType<typeof createRobotEmergencyWsClient>;
    configKey: string;
  }
>();

const buildConfigKey = (robot: EmergencyRobotConfig) => {
  return [robot.ipAddress ?? '', robot.emergencyBridgePort ?? DEFAULT_EMERGENCY_PORT].join(':');
};

const toEventTimestamp = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) return Date.now();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
};

const resolveLegacyEmergencyState = (
  current: RobotEmergencyRuntimeState | undefined,
  event: RobotEmergencyBridgeEvent
): Pick<
  RobotEmergencyRuntimeState,
  'softwareEmergencyActive' | 'hardwareEmergencyActive' | 'effectiveEmergencyActive'
> | null => {
  if (!event.payload || typeof event.payload !== 'object') return null;
  const payload = event.payload as {
    status?: unknown;
  };
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
    timestamp?: unknown;
  };

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

  return {
    robotId,
    robotName: current?.robotName,
    softwareEmergencyActive: resolvedState.softwareEmergencyActive,
    hardwareEmergencyActive: resolvedState.hardwareEmergencyActive,
    effectiveEmergencyActive: resolvedState.effectiveEmergencyActive,
    connectionStatus: 'connected',
    updatedAt: eventAt,
    lastObservedAt,
    lastEventType: event.event as KnownEmergencyEventType,
    lastEventAt: eventAt,
  };
};

const createUnconfiguredState = (robot: EmergencyRobotConfig): RobotEmergencyRuntimeState => ({
  robotId: robot.id,
  robotName: robot.name,
  softwareEmergencyActive: false,
  hardwareEmergencyActive: false,
  effectiveEmergencyActive: false,
  connectionStatus: 'unconfigured',
});

const createDisconnectedState = (robot: EmergencyRobotConfig): RobotEmergencyRuntimeState => ({
  robotId: robot.id,
  robotName: robot.name,
  softwareEmergencyActive: false,
  hardwareEmergencyActive: false,
  effectiveEmergencyActive: false,
  connectionStatus: 'disconnected',
});

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const useRobotEmergencyStore = create<EmergencyStoreState>((set, get) => ({
  byRobot: {},
  pendingDispatch: null,
  lastDispatchResult: null,

  syncRobots: robots => {
    const nextIds = new Set(robots.map(robot => robot.id));
    const nextByRobot = { ...get().byRobot };

    for (const robot of robots) {
      const current = nextByRobot[robot.id];
      const hasSocketConfig = Boolean(robot.ipAddress);

      if (!hasSocketConfig) {
        clients.get(robot.id)?.client.disconnect();
        clients.delete(robot.id);
        nextByRobot[robot.id] = {
          ...(current ?? createUnconfiguredState(robot)),
          robotName: robot.name,
          connectionStatus: 'unconfigured',
        };
        continue;
      }

      const configKey = buildConfigKey(robot);
      const existing = clients.get(robot.id);
      if (!existing || existing.configKey !== configKey) {
        existing?.client.disconnect();
        const client = createRobotEmergencyWsClient(
          robot.ipAddress as string,
          robot.emergencyBridgePort ?? DEFAULT_EMERGENCY_PORT,
          {
            robotId: robot.id,
            robotName: robot.name,
          }
        );

        client.addStatusListener(status => {
          set(store => {
            const currentState = store.byRobot[robot.id] ?? createDisconnectedState(robot);
            return {
              byRobot: {
                ...store.byRobot,
                [robot.id]: {
                  ...currentState,
                  robotName: robot.name,
                  connectionStatus: status,
                },
              },
            };
          });
        });

        client.addEventListener(event => {
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
      }

      nextByRobot[robot.id] = {
        ...(current ?? createDisconnectedState(robot)),
        robotName: robot.name,
        connectionStatus:
          (clients.get(robot.id)?.client.getStatus() as RobotEmergencyConnectionStatus) ??
          current?.connectionStatus ??
          'disconnected',
      };
    }

    for (const robotId of Object.keys(nextByRobot)) {
      if (nextIds.has(robotId)) continue;
      delete nextByRobot[robotId];
    }

    set({ byRobot: nextByRobot });

    for (const [robotId, entry] of Array.from(clients.entries())) {
      if (nextIds.has(robotId)) continue;
      entry.client.disconnect();
      clients.delete(robotId);
    }
  },

  disconnectAll: () => {
    for (const entry of clients.values()) {
      entry.client.disconnect();
    }
    clients.clear();
    set({
      byRobot: {},
      pendingDispatch: null,
    });
  },

  sendFleetSoftwareEmergency: async desiredStatus => {
    const startedAt = Date.now();
    const currentState = get();
    const robotIds = Object.keys(currentState.byRobot);
    const immediateFailures = new Map<string, string>();

    set({
      pendingDispatch: {
        desiredStatus,
        startedAt,
        robotIds,
      },
    });

    for (const robotId of robotIds) {
      const entry = clients.get(robotId);
      const robotState = get().byRobot[robotId];
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

    await sleep(DISPATCH_TIMEOUT_MS);

    const snapshot = get().byRobot;
    const results = robotIds.map(robotId => {
      const state = snapshot[robotId];
      const immediateFailure = immediateFailures.get(robotId);
      const applied =
        !immediateFailure &&
        state?.connectionStatus === 'connected' &&
        state?.lastEventType === 'SOFTWARE_EMERGENCY_ACK' &&
        typeof state.lastEventAt === 'number' &&
        state.lastEventAt >= startedAt &&
        state.softwareEmergencyActive === desiredStatus;

      return {
        robotId,
        robotName: state?.robotName,
        applied,
        connectionStatus: state?.connectionStatus ?? 'unconfigured',
        softwareEmergencyActive: state?.softwareEmergencyActive ?? null,
        hardwareEmergencyActive: state?.hardwareEmergencyActive ?? null,
        effectiveEmergencyActive: state?.effectiveEmergencyActive ?? null,
        error: applied
          ? null
          : (immediateFailure ?? 'No matching emergency acknowledgment received'),
      };
    });

    const successCount = results.filter(result => result.applied).length;
    const status =
      successCount === results.length
        ? 'success'
        : successCount === 0
          ? 'failure'
          : 'partial_failure';

    const completedAt = new Date().toISOString();
    const result: FleetEmergencyDispatchResult = {
      desiredStatus,
      status,
      results,
      dispatchedAt: new Date(startedAt).toISOString(),
      completedAt,
    };

    set({
      lastDispatchResult: result,
      pendingDispatch:
        get().pendingDispatch?.startedAt === startedAt ? null : get().pendingDispatch,
    });

    return result;
  },
}));
