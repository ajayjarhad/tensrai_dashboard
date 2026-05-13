import { resolveWsBaseUrl } from '@/lib/api';

type WsEvent =
  | { type: 'event'; channel: string; data: unknown }
  | { type: 'error'; channel?: string; requestId?: string; message: string }
  | { type: 'response'; channel: string; requestId?: string; data: unknown };

type EventHandler = (event: WsEvent) => void;
type StatusHandler = (status: ConnectionStatus) => void;

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';
export type CommandDispatchStatus = 'sent' | 'queued' | 'dropped';
export type CommandDispatchResult = {
  status: CommandDispatchStatus;
  reason?: string;
  commandId?: string;
};

const MAX_OUTBOUND_QUEUE = 100;
const BUFFERED_COMMAND_CHANNELS = new Set(['mode', 'initialpose', 'emergency']);
const COMMAND_LOG_INTERVAL_MS = (() => {
  const raw = Number(import.meta.env['VITE_ROS_COMMAND_LOG_INTERVAL_MS'] ?? 2000);
  if (!Number.isFinite(raw) || raw < 0) return 2000;
  return raw;
})();

export const createRobotWsClient = (robotId: string) => {
  let socket: WebSocket | null = null;
  let status: ConnectionStatus = 'disconnected';
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let connectTimer: ReturnType<typeof setTimeout> | null = null;
  let shouldReconnect = true;
  const outboundQueue: string[] = [];
  const eventHandlers = new Set<EventHandler>();
  const statusHandlers = new Set<StatusHandler>();
  const lastCommandLogAt = new Map<string, number>();

  const wsUrl = `${resolveWsBaseUrl()}/ws/robots/${robotId}/telemetry/${encodeURIComponent(
    `telemetry-${robotId}`
  )}`;

  const notifyStatus = (next: ConnectionStatus) => {
    status = next;
    statusHandlers.forEach(handler => {
      handler(next);
    });
  };

  const clearConnectTimer = () => {
    if (!connectTimer) return;
    clearTimeout(connectTimer);
    connectTimer = null;
  };

  const scheduleConnectTimeout = () => {
    clearConnectTimer();
    connectTimer = setTimeout(() => {
      if (!socket || socket.readyState !== WebSocket.CONNECTING) return;
      notifyStatus('error');
      try {
        socket.close();
      } catch {}
    }, 8000);
  };

  const createCommandId = (channel: string) => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `${robotId}:${channel}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  };

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
        connectionStatus: status,
        socketReadyState: socket?.readyState ?? null,
        bufferedAmount: socket?.bufferedAmount ?? null,
      })
    );
  };

  const enqueueOutbound = (payload: string, commandId?: string): CommandDispatchResult => {
    if (outboundQueue.length >= MAX_OUTBOUND_QUEUE) {
      // Drop oldest buffered command so the queue remains bounded during long disconnects.
      outboundQueue.shift();
    }
    outboundQueue.push(payload);
    return { status: 'queued', ...(commandId ? { commandId } : {}) };
  };

  const flushOutbound = () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    while (outboundQueue.length > 0) {
      const nextPayload = outboundQueue.shift();
      if (!nextPayload) continue;
      try {
        socket.send(nextPayload);
      } catch {
        outboundQueue.unshift(nextPayload);
        notifyStatus('error');
        break;
      }
    }
  };

  const connect = () => {
    shouldReconnect = true;
    if (
      socket &&
      (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    notifyStatus('connecting');
    socket = new WebSocket(wsUrl);
    scheduleConnectTimeout();

    socket.onopen = () => {
      clearConnectTimer();
      reconnectAttempts = 0;
      notifyStatus('connected');
      flushOutbound();
    };

    const notifyEvent = (event: MessageEvent) => {
      if (status !== 'connected') return;
      try {
        const parsed = JSON.parse(event.data as string) as WsEvent;
        eventHandlers.forEach(handler => {
          handler(parsed);
        });
      } catch {
        // ignore malformed messages
      }
    };

    socket.onmessage = notifyEvent;

    socket.onerror = () => {
      notifyStatus('error');
    };

    socket.onclose = () => {
      clearConnectTimer();
      notifyStatus('disconnected');
      if (shouldReconnect) scheduleReconnect();
    };
  };

  const disconnect = () => {
    shouldReconnect = false;
    clearConnectTimer();
    outboundQueue.length = 0;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (socket) {
      socket.onclose = null;
      try {
        socket.close();
      } catch {}
    }
    socket = null;
    notifyStatus('disconnected');
  };

  const scheduleReconnect = () => {
    if (!shouldReconnect || reconnectTimer) return;
    const delay = Math.min(1000 * 2 ** reconnectAttempts, 10000);
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const sendCommand = (channel: string, data: unknown): CommandDispatchResult => {
    const commandId = createCommandId(channel);
    if (!shouldReconnect) {
      logCommandDispatch(channel, commandId, 'dropped', 'client_disconnected');
      return { status: 'dropped', reason: 'client_disconnected', commandId };
    }

    const canBuffer = BUFFERED_COMMAND_CHANNELS.has(channel);
    const payload = JSON.stringify({
      type: 'command',
      channel,
      commandId,
      sentAtMs: Date.now(),
      data,
    });

    if (!socket) {
      connect();
      const result = canBuffer
        ? enqueueOutbound(payload, commandId)
        : ({ status: 'dropped', reason: 'socket_not_ready', commandId } as CommandDispatchResult);
      logCommandDispatch(channel, commandId, result.status, result.reason);
      return result;
    }

    if (socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(payload);
        logCommandDispatch(channel, commandId, 'sent');
        return { status: 'sent', commandId };
      } catch {
        const result = canBuffer
          ? enqueueOutbound(payload, commandId)
          : ({ status: 'dropped', reason: 'send_failed', commandId } as CommandDispatchResult);
        logCommandDispatch(channel, commandId, result.status, result.reason);
        return result;
      }
    }

    if (socket.readyState === WebSocket.CONNECTING) {
      const result = canBuffer
        ? enqueueOutbound(payload, commandId)
        : ({ status: 'dropped', reason: 'socket_connecting', commandId } as CommandDispatchResult);
      logCommandDispatch(channel, commandId, result.status, result.reason);
      return result;
    }

    connect();
    const result = canBuffer
      ? enqueueOutbound(payload, commandId)
      : ({ status: 'dropped', reason: 'socket_not_open', commandId } as CommandDispatchResult);
    logCommandDispatch(channel, commandId, result.status, result.reason);
    return result;
  };

  const addEventListener = (handler: EventHandler) => {
    eventHandlers.add(handler);
    return () => eventHandlers.delete(handler);
  };

  const addStatusListener = (handler: StatusHandler) => {
    statusHandlers.add(handler);
    handler(status);
    return () => statusHandlers.delete(handler);
  };

  return {
    connect,
    disconnect,
    sendCommand,
    addEventListener,
    addStatusListener,
    getStatus: () => status,
  };
};
