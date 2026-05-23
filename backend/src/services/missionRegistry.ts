import EventEmitter from 'node:events';
import type { PrismaClient } from '@prisma/client';
import WebSocket from 'ws';
import { MissionRunStore } from './missionRunStore.js';
import {
  hydrateMissionStateFromPersistedRun,
  isMissionStatusEvent,
  recordMissionCommandIntent,
  updateMissionFromEvent,
} from './missionStatus.js';
import { type SyncResult, syncRobotStatusUpdate } from './robotStatusSync.js';

type MissionConnectionStatus =
  | 'unconfigured'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

type LoggerLike = {
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
  debug?: (obj: Record<string, unknown>, msg: string) => void;
};

type RobotMissionConfig = {
  id: string;
  name: string;
  ipAddress?: string | null | undefined;
  mapId?: string | null | undefined;
  missionBridgePort?: number | null | undefined;
  mappingBridgePort?: number | null | undefined;
  url?: string | undefined;
};

type ActiveConnection = {
  socket: WebSocket;
  manualClose: boolean;
};

const DEFAULT_MISSION_BRIDGE_PORT = Number(process.env['ROS_MISSION_BRIDGE_PORT'] ?? 9487);
const DEFAULT_MAPPING_BRIDGE_PORT = Number(process.env['ROS_MAPPING_BRIDGE_PORT'] ?? 8765);
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 10_000;

const formatError = (error: unknown) =>
  error instanceof Error
    ? { message: error.message, name: error.name, stack: error.stack }
    : { message: String(error), raw: error };

const parseGatewayEvent = (payload: string): { event: string; payload?: unknown } | null => {
  try {
    const parsed = JSON.parse(payload);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.event !== 'string' || parsed.event.trim().length === 0) return null;
    return parsed as { event: string; payload?: unknown };
  } catch {
    return null;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const normalizeOpaqueId = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const next = value.trim();
  return next.length > 0 ? next : undefined;
};

const extractMissionCommandId = (raw: unknown): string | undefined => {
  if (!isRecord(raw)) return undefined;
  const payload = isRecord(raw['payload']) ? raw['payload'] : undefined;
  return (
    normalizeOpaqueId(raw['commandId']) ??
    normalizeOpaqueId(raw['requestId']) ??
    normalizeOpaqueId(payload?.['requestId'])
  );
};

const withMissionCommandId = (
  payload: unknown,
  commandId: string | undefined
): Record<string, unknown> | undefined => {
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

export class MissionRegistry extends EventEmitter {
  private prisma: PrismaClient;
  private log: LoggerLike;
  private stopped = false;
  private robotConfigs = new Map<string, RobotMissionConfig>();
  private connections = new Map<string, ActiveConnection>();
  private reconnectTimers = new Map<string, NodeJS.Timeout>();
  private reconnectAttempts = new Map<string, number>();
  private statuses = new Map<string, MissionConnectionStatus>();
  private runStore: MissionRunStore;
  private rememberNonEmergencyStatus:
    | ((robotId: string, status: 'TELEOP' | 'AUTONOMOUS') => void)
    | undefined;

  constructor(
    prisma: PrismaClient,
    log: LoggerLike,
    options?: {
      rememberNonEmergencyStatus?: (robotId: string, status: 'TELEOP' | 'AUTONOMOUS') => void;
    }
  ) {
    super();
    this.prisma = prisma;
    this.log = log;
    this.runStore = new MissionRunStore(prisma, log);
    this.rememberNonEmergencyStatus = options?.rememberNonEmergencyStatus;
  }

  get missionRunStore() {
    return this.runStore;
  }

  async reloadFromDb() {
    try {
      this.log.info({}, 'Loading mission registry from DB');
      await this.runStore.hydrateActiveRuns();
      const persistedActiveRuns = await this.runStore.listRuns({ status: 'active', limit: 500 });
      for (const run of persistedActiveRuns) {
        hydrateMissionStateFromPersistedRun(run.robotId, run);
      }

      const robots = await this.prisma.robot.findMany({
        select: {
          id: true,
          name: true,
          ipAddress: true,
          mapId: true,
          missionBridgePort: true,
          mappingBridgePort: true,
        },
      });

      this.log.info({ robotCount: robots.length }, 'Mission registry robot configs loaded');
      const desiredIds = new Set<string>();

      for (const robot of robots) {
        desiredIds.add(robot.id);
        const port =
          robot.missionBridgePort ?? robot.mappingBridgePort ?? DEFAULT_MISSION_BRIDGE_PORT;
        const url = robot.ipAddress
          ? `ws://${robot.ipAddress}:${port ?? DEFAULT_MAPPING_BRIDGE_PORT}`
          : undefined;
        const nextConfig: RobotMissionConfig = {
          id: robot.id,
          name: robot.name,
          ipAddress: robot.ipAddress,
          mapId: robot.mapId,
          missionBridgePort: robot.missionBridgePort,
          mappingBridgePort: robot.mappingBridgePort,
          url,
        };

        this.log.info(
          {
            robotId: robot.id,
            robotName: robot.name,
            ipAddress: robot.ipAddress,
            missionBridgePort: robot.missionBridgePort,
            mappingBridgePort: robot.mappingBridgePort,
            resolvedMissionBridgeUrl: url,
            existingStatus: this.statuses.get(robot.id) ?? null,
          },
          'Resolved mission bridge config'
        );

        const previous = this.robotConfigs.get(robot.id);
        this.robotConfigs.set(robot.id, nextConfig);

        if (!url) {
          this.log.warn(
            { robotId: robot.id, robotName: robot.name, ipAddress: robot.ipAddress },
            'Mission bridge not configured: robot has no IP address'
          );
          this.disconnectRobot(robot.id);
          this.statuses.set(robot.id, 'unconfigured');
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
        this.log.warn({ robotId }, 'Removing stale mission bridge robot config');
        this.robotConfigs.delete(robotId);
        this.statuses.delete(robotId);
        this.disconnectRobot(robotId);
        this.clearReconnectTimer(robotId);
      }
    } catch (error) {
      this.log.error({ err: formatError(error) }, 'Mission registry DB reload failed');
      throw error;
    }
  }

  stop() {
    this.stopped = true;
    for (const robotId of Array.from(this.reconnectTimers.keys())) {
      this.clearReconnectTimer(robotId);
    }
    for (const robotId of Array.from(this.connections.keys())) {
      this.disconnectRobot(robotId);
    }
  }

  async recordCommandIntent(robotId: string, event: string, payload: any) {
    const config = this.robotConfigs.get(robotId);
    if (!config) return;
    recordMissionCommandIntent(robotId, event, payload);
    await this.runStore.recordCommandIntent(
      {
        robotId,
        robotName: config.name,
        mapId: config.mapId ?? null,
      },
      event,
      payload
    );
  }

  async getCurrentMission(robotId: string) {
    return this.runStore.getCurrentRun(robotId);
  }

  addRobotEventListener(robotId: string, listener: (message: string) => void) {
    const eventName = `robot-event:${robotId}`;
    this.on(eventName, listener);
    return () => {
      this.off(eventName, listener);
    };
  }

  sendCommand(robotId: string, message: string): { ok: boolean; error?: string } {
    const connection = this.connections.get(robotId);
    const status = this.statuses.get(robotId);
    if (!connection || connection.socket.readyState !== WebSocket.OPEN) {
      const config = this.robotConfigs.get(robotId);
      this.log.warn(
        {
          robotId,
          status: status ?? null,
          readyState: connection?.socket.readyState ?? null,
          url: config?.url ?? null,
          hasConnection: !!connection,
        },
        'Mission command rejected: bridge socket is not open'
      );
      return {
        ok: false,
        error:
          status === 'connecting'
            ? 'Mission bridge is still connecting'
            : 'Mission bridge not connected',
      };
    }

    try {
      connection.socket.send(message);
      this.log.info({ robotId, status, bytes: message.length }, 'Mission command sent to bridge');
      return { ok: true };
    } catch (error) {
      this.log.error({ robotId, status, err: formatError(error) }, 'Mission command send failed');
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to send mission command',
      };
    }
  }

  async listMissionRuns(options: { robotId?: string; status?: string; limit?: number }) {
    return this.runStore.listRuns(options);
  }

  private connectRobot(robotId: string) {
    const config = this.robotConfigs.get(robotId);
    if (!config?.url || this.stopped) return;

    this.disconnectRobot(robotId);
    this.clearReconnectTimer(robotId);
    this.statuses.set(robotId, 'connecting');

    this.log.info({ robotId, url: config.url }, 'Connecting to mission bridge');

    let socket: WebSocket;
    try {
      socket = new WebSocket(config.url);
    } catch (error) {
      this.statuses.set(robotId, 'error');
      this.log.error(
        { robotId, url: config.url, err: formatError(error) },
        'Mission bridge socket construction failed'
      );
      this.scheduleReconnect(robotId);
      return;
    }
    const connection: ActiveConnection = { socket, manualClose: false };
    this.connections.set(robotId, connection);

    socket.on('open', () => {
      if (this.connections.get(robotId) !== connection) return;
      this.reconnectAttempts.set(robotId, 0);
      this.statuses.set(robotId, 'connected');
      this.log.info({ robotId, url: config.url }, 'Connected to mission bridge');
    });

    socket.on('message', data => {
      const text = typeof data === 'string' ? data : data.toString('utf8');
      void this.handleSocketMessage(robotId, text).catch(error => {
        this.log.error(
          { robotId, error: error instanceof Error ? error.message : String(error) },
          'Failed to process mission bridge payload'
        );
      });
    });

    socket.on('error', error => {
      if (this.connections.get(robotId) !== connection) return;
      this.statuses.set(robotId, 'error');
      this.log.error(
        { robotId, url: config.url, err: formatError(error) },
        'Mission bridge socket error'
      );
    });

    socket.on('close', (code, reason) => {
      if (this.connections.get(robotId) !== connection) return;
      this.connections.delete(robotId);
      if (connection.manualClose || this.stopped || !this.robotConfigs.get(robotId)?.url) {
        this.statuses.set(robotId, 'disconnected');
        this.log.warn(
          {
            robotId,
            url: config.url,
            code,
            reason: reason.toString('utf8'),
            manualClose: connection.manualClose,
            stopped: this.stopped,
          },
          'Mission bridge socket closed without reconnect'
        );
        return;
      }
      this.statuses.set(robotId, 'disconnected');
      this.log.warn(
        { robotId, url: config.url, code, reason: reason.toString('utf8') },
        'Mission bridge socket closed; scheduling reconnect'
      );
      this.scheduleReconnect(robotId);
    });
  }

  private disconnectRobot(robotId: string) {
    const connection = this.connections.get(robotId);
    if (!connection) return;
    connection.manualClose = true;
    this.connections.delete(robotId);
    try {
      connection.socket.removeAllListeners();
      connection.socket.close();
    } catch {}
  }

  private scheduleReconnect(robotId: string) {
    if (this.stopped || this.reconnectTimers.has(robotId)) return;
    const attempt = this.reconnectAttempts.get(robotId) ?? 0;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
    this.reconnectAttempts.set(robotId, attempt + 1);
    const config = this.robotConfigs.get(robotId);
    this.log.warn(
      { robotId, url: config?.url ?? null, attempt: attempt + 1, delay },
      'Scheduled mission bridge reconnect'
    );
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(robotId);
      this.connectRobot(robotId);
    }, delay);
    this.reconnectTimers.set(robotId, timer);
  }

  private clearReconnectTimer(robotId: string) {
    const timer = this.reconnectTimers.get(robotId);
    if (!timer) return;
    clearTimeout(timer);
    this.reconnectTimers.delete(robotId);
  }

  private async handleSocketMessage(robotId: string, payloadText: string) {
    const parsed = parseGatewayEvent(payloadText);
    if (!parsed?.event || !isMissionStatusEvent(parsed.event)) {
      return;
    }

    const commandId = extractMissionCommandId(parsed);
    const normalizedPayload =
      parsed.payload === undefined
        ? undefined
        : (withMissionCommandId(parsed.payload, commandId) ?? parsed.payload);
    const normalizedPayloadText = JSON.stringify({
      event: parsed.event,
      ...(commandId ? { commandId } : {}),
      ...(normalizedPayload !== undefined ? { payload: normalizedPayload } : {}),
    });

    this.emit(`robot-event:${robotId}`, normalizedPayloadText);

    updateMissionFromEvent(robotId, parsed.event, normalizedPayload);

    if (parsed.event === 'ROBOT_STATUS_UPDATE') {
      const syncDeps: Parameters<typeof syncRobotStatusUpdate>[0] = {
        prisma: this.prisma,
        log: this.log,
      };
      if (this.rememberNonEmergencyStatus) {
        syncDeps.rememberNonEmergencyStatus = this.rememberNonEmergencyStatus;
      }
      const syncResult: SyncResult = await syncRobotStatusUpdate(syncDeps, robotId, parsed.payload);
      if (!syncResult.ok) {
        this.log.warn(
          { robotId, reason: syncResult.reason, event: parsed.event },
          'Dropped ROBOT_STATUS_UPDATE during mission registry sync'
        );
      }
    }

    const config = this.robotConfigs.get(robotId);
    if (!config) return;

    await this.runStore.applyEvent(
      {
        robotId,
        robotName: config.name,
        mapId: config.mapId ?? null,
      },
      parsed.event,
      normalizedPayload
    );
  }
}
