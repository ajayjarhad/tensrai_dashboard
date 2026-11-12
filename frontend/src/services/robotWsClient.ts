import { resolveWsBaseUrl } from '@/lib/api';
import { generateRequestId } from '@/lib/utils/utils';
import { createReconnectingSocket } from './reconnectingSocket';

export type { ConnectionStatus } from './reconnectingSocket';

type WsEvent =
  | { type: 'event'; channel: string; data: unknown }
  | { type: 'error'; channel?: string; requestId?: string; message: string }
  | { type: 'response'; channel: string; requestId?: string; data: unknown };

export type CommandDispatchStatus = 'sent' | 'queued' | 'dropped';
export type CommandDispatchResult = {
  status: CommandDispatchStatus;
  reason?: string;
  commandId?: string;
};

const BUFFERED_COMMAND_CHANNELS = new Set(['mode', 'initialpose', 'emergency']);
const COMMAND_LOG_INTERVAL_MS = (() => {
  const raw = Number(import.meta.env['VITE_ROS_COMMAND_LOG_INTERVAL_MS'] ?? 2000);
  if (!Number.isFinite(raw) || raw < 0) return 2000;
  return raw;
})();

export const createRobotWsClient = (robotId: string) => {
  const lastCommandLogAt = new Map<string, number>();

  const wsUrl = `${resolveWsBaseUrl()}/ws/robots/${robotId}/telemetry/${encodeURIComponent(
    `telemetry-${robotId}`
  )}`;

  const connection = createReconnectingSocket<WsEvent>({
    createSocket: () => new WebSocket(wsUrl),
    parseFrame: (data, status) =>
      status === 'connected' ? (JSON.parse(data as string) as WsEvent) : undefined,
  });

  const logCommandDispatch = (
    channel: string,
    commandId: string,
    dispatchStatus: CommandDispatchStatus,
    reason?: string
  ) => {
    const now = Date.now();
    const shouldThrottle = channel === 'teleop' && dispatchStatus === 'sent';
    const last = lastCommandLogAt.get(channel) ?? 0;
    if (shouldThrottle && now - last < COMMAND_LOG_INTERVAL_MS) return;
    lastCommandLogAt.set(channel, now);
    console.info(
      '[ros-bridge-command]',
      JSON.stringify({
        robotId,
        channel,
        commandId,
        status: dispatchStatus,
        reason,
        connectionStatus: connection.getStatus(),
        socketReadyState: connection.readyState(),
        bufferedAmount: connection.bufferedAmount(),
      })
    );
  };

  const sendCommand = (channel: string, data: unknown): CommandDispatchResult => {
    const commandId = generateRequestId();
    if (connection.isStopped()) {
      logCommandDispatch(channel, commandId, 'dropped', 'client_disconnected');
      return { status: 'dropped', reason: 'client_disconnected', commandId };
    }

    const payload = JSON.stringify({
      type: 'command',
      channel,
      commandId,
      sentAtMs: Date.now(),
      data,
    });

    const failure = connection.sendOrConnect(payload);
    if (!failure) {
      logCommandDispatch(channel, commandId, 'sent');
      return { status: 'sent', commandId };
    }

    if (BUFFERED_COMMAND_CHANNELS.has(channel)) {
      connection.enqueue(payload);
      logCommandDispatch(channel, commandId, 'queued');
      return { status: 'queued', commandId };
    }

    logCommandDispatch(channel, commandId, 'dropped', failure);
    return { status: 'dropped', reason: failure, commandId };
  };

  return {
    connect: connection.connect,
    disconnect: connection.disconnect,
    sendCommand,
    addEventListener: connection.addEventListener,
    addStatusListener: connection.addStatusListener,
    getStatus: connection.getStatus,
  };
};
