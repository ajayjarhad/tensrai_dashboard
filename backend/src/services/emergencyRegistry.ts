import type { PrismaClient, RobotMode } from '@prisma/client';
import WebSocket from 'ws';
import { emergencyMetrics } from '../metrics/index.js';
import { deriveRobotModeFromMissionState } from './missionStatus.js';

type RobotEmergencyConnectionStatus =
  | 'unconfigured'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

type RobotEmergencyStatePayload = {
  softwareEmergencyActive: boolean;
  hardwareEmergencyActive: boolean;
  effectiveEmergencyActive: boolean;
  timestamp?: string;
};

type RobotEmergencyAckPayload = RobotEmergencyStatePayload & {
  status: boolean;
};

type RobotEmergencyBridgeEvent =
  | { event: 'EMERGENCY_STATE'; payload?: RobotEmergencyStatePayload }
  | { event: 'SOFTWARE_EMERGENCY_ACK'; payload?: RobotEmergencyAckPayload }
  | { event: 'HARDWARE_EMERGENCY_ACK'; payload?: RobotEmergencyAckPayload }
  | { event: string; payload?: unknown };

const DEFAULT_EMERGENCY_BRIDGE_PORT = Number(process.env['ROS_EMERGENCY_BRIDGE_PORT'] ?? 8766);
const SNAPSHOT_TIMEOUT_MS = 5_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 10_000;

type LoggerLike = {
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
  debug?: (obj: Record<string, unknown>, msg: string) => void;
};

type RobotEmergencyConfig = {
  id: string;
  name: string;
  status: RobotMode;
  statusBeforeEmergency?: RobotMode | null;
  ipAddress?: string | null;
  emergencyBridgePort?: number | null;
  url?: string | undefined;
};

type RobotEmergencyState = {
  softwareEmergencyActive: boolean;
  hardwareEmergencyActive: boolean;
  effectiveEmergencyActive: boolean;
  connectionStatus: RobotEmergencyConnectionStatus;
  updatedAt: number;
};

type ActiveConnection = {
  socket: WebSocket;
  manualClose: boolean;
};
type RobotEventListener = (payloadText: string) => void;

const isEmergencyRobotMode = (status: unknown): status is RobotMode =>
  status === 'SW_EMERGENCY' || status === 'HW_EMERGENCY';

const EMERGENCY_EVENTS = new Set([
  'EMERGENCY_STATE',
  'SOFTWARE_EMERGENCY_ACK',
  'HARDWARE_EMERGENCY_ACK',
]);

const parseTimestampMs = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) return Date.now();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
};

const isRobotEmergencyStatePayload = (value: unknown): value is RobotEmergencyStatePayload => {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<RobotEmergencyStatePayload>;
  return (
    typeof payload.softwareEmergencyActive === 'boolean' &&
    typeof payload.hardwareEmergencyActive === 'boolean' &&
    typeof payload.effectiveEmergencyActive === 'boolean'
  );
};

const isRobotEmergencyAckPayload = (value: unknown): value is RobotEmergencyAckPayload => {
  if (!isRobotEmergencyStatePayload(value)) return false;
  return typeof (value as Partial<RobotEmergencyAckPayload>).status === 'boolean';
};

const resolveLegacyEmergencyStatePayload = (
  current: RobotEmergencyState | undefined,
  event: RobotEmergencyBridgeEvent
): RobotEmergencyStatePayload | null => {
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

const parseRobotEmergencyEvent = (raw: unknown): RobotEmergencyBridgeEvent | null => {
  if (!raw || typeof raw !== 'object') return null;
  const event = (raw as { event?: unknown }).event;
  if (typeof event !== 'string' || !EMERGENCY_EVENTS.has(event)) return null;
  return {
    event,
    payload: (raw as { payload?: unknown }).payload,
  };
};

const sameEmergencyState = (left?: RobotEmergencyState, right?: RobotEmergencyState) => {
  if (!left || !right) return false;
  return (
    left.softwareEmergencyActive === right.softwareEmergencyActive &&
    left.hardwareEmergencyActive === right.hardwareEmergencyActive &&
    left.effectiveEmergencyActive === right.effectiveEmergencyActive &&
    left.connectionStatus === right.connectionStatus
  );
};

const resolveTargetStatus = (
  state: Pick<
    RobotEmergencyState,
    'softwareEmergencyActive' | 'hardwareEmergencyActive' | 'effectiveEmergencyActive'
  >,
  fallbackStatus: RobotMode
): RobotMode => {
  if (state.hardwareEmergencyActive) return 'HW_EMERGENCY';
  if (state.softwareEmergencyActive) return 'SW_EMERGENCY';
  return fallbackStatus;
};

export class EmergencyRegistry {
  private prisma: PrismaClient;
  private log: LoggerLike;
  private stopped = false;
  private robotConfigs = new Map<string, RobotEmergencyConfig>();
  private connections = new Map<string, ActiveConnection>();
  private reconnectTimers = new Map<string, NodeJS.Timeout>();
  private snapshotTimers = new Map<string, NodeJS.Timeout>();
  private reconnectAttempts = new Map<string, number>();
  private states = new Map<string, RobotEmergencyState>();
  private lastNonEmergencyStatusByRobot = new Map<string, RobotMode>();
  private robotEventListeners = new Map<string, Set<RobotEventListener>>();

  constructor(prisma: PrismaClient, log: LoggerLike) {
    this.prisma = prisma;
    this.log = log;
  }

  rememberNonEmergencyStatus(robotId: string, status: RobotMode | undefined | null) {
    if (!status || isEmergencyRobotMode(status)) return;
    this.lastNonEmergencyStatusByRobot.set(robotId, status);
  }

  async reloadFromDb() {
    const robots = await this.prisma.robot.findMany({
      select: {
        id: true,
        name: true,
        status: true,
        statusBeforeEmergency: true,
        ipAddress: true,
        emergencyBridgePort: true,
      },
    });

    const desiredIds = new Set<string>();

    for (const robot of robots) {
      desiredIds.add(robot.id);
      if (isEmergencyRobotMode(robot.status)) {
        this.rememberNonEmergencyStatus(robot.id, robot.statusBeforeEmergency);
      } else {
        this.rememberNonEmergencyStatus(robot.id, robot.status);
      }

      const port = robot.emergencyBridgePort ?? DEFAULT_EMERGENCY_BRIDGE_PORT;
      const url = robot.ipAddress ? `ws://${robot.ipAddress}:${port}` : undefined;
      const nextConfig: RobotEmergencyConfig = {
        id: robot.id,
        name: robot.name,
        status: robot.status,
        statusBeforeEmergency: robot.statusBeforeEmergency,
        ipAddress: robot.ipAddress,
        emergencyBridgePort: robot.emergencyBridgePort,
        url,
      };

      const previous = this.robotConfigs.get(robot.id);
      this.robotConfigs.set(robot.id, nextConfig);

      if (!url) {
        this.disconnectRobot(robot.id);
        this.setConnectionStatus(robot.id, 'unconfigured');
        continue;
      }

      const connection = this.connections.get(robot.id);
      if (connection && previous?.url === url) {
        continue;
      }

      this.connectRobot(robot.id);
    }

    for (const robotId of Array.from(this.robotConfigs.keys())) {
      if (desiredIds.has(robotId)) continue;
      this.robotConfigs.delete(robotId);
      this.lastNonEmergencyStatusByRobot.delete(robotId);
      this.states.delete(robotId);
      this.disconnectRobot(robotId);
      this.clearReconnectTimer(robotId);
      this.clearSnapshotTimer(robotId);
    }
  }

  stop() {
    this.stopped = true;

    for (const robotId of Array.from(this.reconnectTimers.keys())) {
      this.clearReconnectTimer(robotId);
    }
    for (const robotId of Array.from(this.snapshotTimers.keys())) {
      this.clearSnapshotTimer(robotId);
    }
    for (const robotId of Array.from(this.connections.keys())) {
      this.disconnectRobot(robotId);
    }
  }

  addRobotEventListener(robotId: string, listener: RobotEventListener) {
    const listeners = this.robotEventListeners.get(robotId) ?? new Set<RobotEventListener>();
    listeners.add(listener);
    this.robotEventListeners.set(robotId, listeners);
    return () => {
      const next = this.robotEventListeners.get(robotId);
      if (!next) return;
      next.delete(listener);
      if (next.size === 0) {
        this.robotEventListeners.delete(robotId);
      }
    };
  }

  getRobotSnapshotEvent(robotId: string): string {
    const current = this.states.get(robotId);
    const hasConfig = this.robotConfigs.has(robotId);
    const configuredUrl = this.robotConfigs.get(robotId)?.url;
    const connectionStatus: RobotEmergencyConnectionStatus =
      current?.connectionStatus ?? (!hasConfig || !configuredUrl ? 'unconfigured' : 'disconnected');

    return JSON.stringify({
      event: 'EMERGENCY_STATE',
      payload: {
        softwareEmergencyActive: current?.softwareEmergencyActive ?? false,
        hardwareEmergencyActive: current?.hardwareEmergencyActive ?? false,
        effectiveEmergencyActive: current?.effectiveEmergencyActive ?? false,
        connectionStatus,
        timestamp: new Date(current?.updatedAt ?? Date.now()).toISOString(),
      },
    });
  }

  sendSoftwareEmergency(robotId: string, desiredStatus: boolean): { ok: boolean; error?: string } {
    const connection = this.connections.get(robotId);
    const currentStatus = this.states.get(robotId)?.connectionStatus;
    const configuredUrl = this.robotConfigs.get(robotId)?.url;
    const inferredStatus: RobotEmergencyConnectionStatus =
      currentStatus ?? (configuredUrl ? 'disconnected' : 'unconfigured');

    if (!connection || connection.socket.readyState !== WebSocket.OPEN) {
      return {
        ok: false,
        error:
          inferredStatus === 'unconfigured'
            ? 'Emergency bridge not configured'
            : inferredStatus === 'connecting'
              ? 'Emergency bridge is still connecting'
              : 'Emergency bridge not connected',
      };
    }

    try {
      connection.socket.send(
        JSON.stringify({
          event: 'SOFTWARE_EMERGENCY',
          payload: { status: desiredStatus },
        })
      );
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to send emergency command',
      };
    }
  }

  private emitRobotEvent(robotId: string, payloadText: string) {
    const listeners = this.robotEventListeners.get(robotId);
    if (!listeners || listeners.size === 0) return;
    for (const listener of Array.from(listeners)) {
      try {
        listener(payloadText);
      } catch (error) {
        this.log.warn(
          {
            robotId,
            error: error instanceof Error ? error.message : String(error),
          },
          'Emergency registry listener callback failed'
        );
      }
    }
  }

  private connectRobot(robotId: string) {
    const config = this.robotConfigs.get(robotId);
    if (!config?.url || this.stopped) return;

    this.disconnectRobot(robotId);
    this.clearReconnectTimer(robotId);
    this.setConnectionStatus(robotId, 'connecting');

    const socket = new WebSocket(config.url);
    const connection: ActiveConnection = {
      socket,
      manualClose: false,
    };

    this.connections.set(robotId, connection);

    socket.on('open', () => {
      if (this.connections.get(robotId) !== connection) return;
      this.reconnectAttempts.set(robotId, 0);
      emergencyMetrics.connectionEvents.add(1, {
        'robot.id': robotId,
        'connection.status': 'connected',
      });
      this.setConnectionStatus(robotId, 'connected');
      this.scheduleSnapshotTimeout(robotId);
      this.log.info({ robotId, url: config.url }, 'Connected to emergency bridge');
    });

    socket.on('message', data => {
      const text = typeof data === 'string' ? data : data.toString('utf8');
      void this.handleSocketMessage(robotId, text).catch(error => {
        this.log.error(
          {
            robotId,
            error: error instanceof Error ? error.message : String(error),
          },
          'Failed to process emergency bridge payload'
        );
      });
    });

    socket.on('error', error => {
      if (this.connections.get(robotId) !== connection) return;
      emergencyMetrics.connectionEvents.add(1, {
        'robot.id': robotId,
        'connection.status': 'error',
      });
      this.setConnectionStatus(robotId, 'error');
      this.log.error(
        {
          robotId,
          url: config.url,
          error: error instanceof Error ? error.message : String(error),
        },
        'Emergency bridge socket error'
      );
    });

    socket.on('close', () => {
      if (this.connections.get(robotId) !== connection) return;
      this.connections.delete(robotId);
      this.clearSnapshotTimer(robotId);

      if (connection.manualClose || this.stopped || !this.robotConfigs.get(robotId)?.url) {
        return;
      }

      emergencyMetrics.connectionEvents.add(1, {
        'robot.id': robotId,
        'connection.status': 'disconnected',
      });
      this.setConnectionStatus(robotId, 'disconnected');
      this.scheduleReconnect(robotId);
      this.log.warn({ robotId, url: config.url }, 'Emergency bridge disconnected');
    });
  }

  private disconnectRobot(robotId: string) {
    const connection = this.connections.get(robotId);
    if (!connection) return;
    connection.manualClose = true;
    this.connections.delete(robotId);
    this.clearSnapshotTimer(robotId);
    try {
      connection.socket.close();
    } catch {}
  }

  private clearReconnectTimer(robotId: string) {
    const timer = this.reconnectTimers.get(robotId);
    if (!timer) return;
    clearTimeout(timer);
    this.reconnectTimers.delete(robotId);
  }

  private clearSnapshotTimer(robotId: string) {
    const timer = this.snapshotTimers.get(robotId);
    if (!timer) return;
    clearTimeout(timer);
    this.snapshotTimers.delete(robotId);
  }

  private scheduleReconnect(robotId: string) {
    if (this.reconnectTimers.has(robotId) || this.stopped) return;
    const attempts = this.reconnectAttempts.get(robotId) ?? 0;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempts, RECONNECT_MAX_MS);
    this.reconnectAttempts.set(robotId, attempts + 1);
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(robotId);
      this.connectRobot(robotId);
    }, delay);
    this.reconnectTimers.set(robotId, timer);
  }

  private scheduleSnapshotTimeout(robotId: string) {
    this.clearSnapshotTimer(robotId);
    const timer = setTimeout(() => {
      this.snapshotTimers.delete(robotId);
      const state = this.states.get(robotId);
      if (state?.connectionStatus === 'connected') {
        emergencyMetrics.snapshotTimeouts.add(1, { 'robot.id': robotId });
        this.log.warn({ robotId }, 'Emergency bridge connected without snapshot payload');
      }
    }, SNAPSHOT_TIMEOUT_MS);
    this.snapshotTimers.set(robotId, timer);
  }

  private setConnectionStatus(robotId: string, connectionStatus: RobotEmergencyConnectionStatus) {
    const current = this.states.get(robotId);
    const next: RobotEmergencyState = {
      softwareEmergencyActive: current?.softwareEmergencyActive ?? false,
      hardwareEmergencyActive: current?.hardwareEmergencyActive ?? false,
      effectiveEmergencyActive: current?.effectiveEmergencyActive ?? false,
      connectionStatus,
      updatedAt: Date.now(),
    };

    if (sameEmergencyState(current, next)) return;
    this.states.set(robotId, next);
    this.emitRobotEvent(robotId, this.getRobotSnapshotEvent(robotId));
  }

  private normalizeState(
    payload: RobotEmergencyStatePayload,
    connectionStatus: RobotEmergencyConnectionStatus
  ) {
    return {
      softwareEmergencyActive: payload.softwareEmergencyActive,
      hardwareEmergencyActive: payload.hardwareEmergencyActive,
      effectiveEmergencyActive: payload.effectiveEmergencyActive,
      connectionStatus,
      updatedAt: parseTimestampMs(payload.timestamp),
    } satisfies RobotEmergencyState;
  }

  private async handleSocketMessage(robotId: string, payloadText: string) {
    const parsed = (() => {
      try {
        return parseRobotEmergencyEvent(JSON.parse(payloadText));
      } catch {
        return null;
      }
    })();

    if (!parsed) {
      this.log.warn({ robotId, payloadText }, 'Dropped invalid emergency bridge payload');
      return;
    }
    this.emitRobotEvent(robotId, payloadText);

    let normalized: RobotEmergencyState | null = null;
    const currentState = this.states.get(robotId);

    if (parsed.event === 'EMERGENCY_STATE') {
      if (!isRobotEmergencyStatePayload(parsed.payload)) {
        this.log.warn(
          { robotId, event: parsed.event },
          'Dropped emergency state with invalid payload'
        );
        return;
      }
      normalized = this.normalizeState(parsed.payload, 'connected');
    } else {
      const resolvedPayload = isRobotEmergencyAckPayload(parsed.payload)
        ? parsed.payload
        : resolveLegacyEmergencyStatePayload(currentState, parsed);

      if (!resolvedPayload) {
        this.log.warn(
          { robotId, event: parsed.event },
          'Dropped emergency ACK with invalid payload'
        );
        return;
      }
      normalized = this.normalizeState(resolvedPayload, 'connected');
    }

    this.clearSnapshotTimer(robotId);

    const previous = currentState;
    this.states.set(robotId, normalized);

    if (sameEmergencyState(previous, normalized)) {
      return;
    }

    emergencyMetrics.stateTransitions.add(1, {
      'robot.id': robotId,
      'emergency.software': String(normalized.softwareEmergencyActive),
      'emergency.hardware': String(normalized.hardwareEmergencyActive),
      'emergency.effective': String(normalized.effectiveEmergencyActive),
    });

    await this.syncRobotStatus(robotId, normalized);
  }

  private resolveRestoreStatus(
    robotId: string,
    currentStatus?: RobotMode | null,
    persistedStatusBeforeEmergency?: RobotMode | null
  ): RobotMode {
    const remembered = this.lastNonEmergencyStatusByRobot.get(robotId);
    if (remembered && remembered !== 'UNKNOWN' && !isEmergencyRobotMode(remembered)) {
      return remembered;
    }

    if (
      persistedStatusBeforeEmergency &&
      persistedStatusBeforeEmergency !== 'UNKNOWN' &&
      !isEmergencyRobotMode(persistedStatusBeforeEmergency)
    ) {
      return persistedStatusBeforeEmergency;
    }

    const derived = deriveRobotModeFromMissionState(robotId);
    if (derived) {
      return derived;
    }

    if (currentStatus && currentStatus !== 'UNKNOWN' && !isEmergencyRobotMode(currentStatus)) {
      return currentStatus;
    }

    if (remembered && !isEmergencyRobotMode(remembered)) {
      return remembered;
    }

    return 'UNKNOWN';
  }

  private async syncRobotStatus(
    robotId: string,
    state: Pick<
      RobotEmergencyState,
      'softwareEmergencyActive' | 'hardwareEmergencyActive' | 'effectiveEmergencyActive'
    >
  ) {
    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      select: { status: true, statusBeforeEmergency: true },
    });

    if (!robot) return;

    const restoreStatus = this.resolveRestoreStatus(
      robotId,
      robot.status,
      robot.statusBeforeEmergency
    );
    if (state.effectiveEmergencyActive && !isEmergencyRobotMode(restoreStatus)) {
      this.lastNonEmergencyStatusByRobot.set(robotId, restoreStatus);
    }

    const nextStatus = resolveTargetStatus(state, restoreStatus);
    if (robot.status === nextStatus) return;

    await this.prisma.robot.update({
      where: { id: robotId },
      data: {
        status: nextStatus,
        statusBeforeEmergency: isEmergencyRobotMode(nextStatus) ? restoreStatus : null,
        lastSeen: new Date(),
      },
    });

    emergencyMetrics.dbSyncWrites.add(1, {
      'robot.id': robotId,
      'robot.status': nextStatus,
    });

    if (!isEmergencyRobotMode(nextStatus)) {
      this.lastNonEmergencyStatusByRobot.set(robotId, nextStatus);
    }

    this.log.info(
      {
        robotId,
        previousStatus: robot.status,
        nextStatus,
      },
      'Synced robot status from emergency bridge'
    );
  }
}
