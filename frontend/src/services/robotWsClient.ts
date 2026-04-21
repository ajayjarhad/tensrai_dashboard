import { resolveWsBaseUrl } from '@/lib/api';

type WsEvent =
  | { type: 'event'; channel: string; data: unknown }
  | { type: 'error'; channel?: string; message: string }
  | { type: 'response'; channel: string; requestId?: string; data: unknown };

type EventHandler = (event: WsEvent) => void;
type StatusHandler = (status: ConnectionStatus) => void;

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';
export type CommandDispatchStatus = 'sent' | 'queued' | 'dropped';
export type CommandDispatchResult = {
  status: CommandDispatchStatus;
  reason?: string;
};

const MAX_OUTBOUND_QUEUE = 100;
const BUFFERED_COMMAND_CHANNELS = new Set(['mode', 'initialpose', 'emergency']);

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

  const enqueueOutbound = (payload: string): CommandDispatchResult => {
    if (outboundQueue.length >= MAX_OUTBOUND_QUEUE) {
      // Drop oldest buffered command so the queue remains bounded during long disconnects.
      outboundQueue.shift();
    }
    outboundQueue.push(payload);
    return { status: 'queued' };
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
    if (!shouldReconnect) {
      return { status: 'dropped', reason: 'client_disconnected' };
    }

    const canBuffer = BUFFERED_COMMAND_CHANNELS.has(channel);
    const payload = JSON.stringify({ type: 'command', channel, data });

    if (!socket) {
      connect();
      return canBuffer
        ? enqueueOutbound(payload)
        : { status: 'dropped', reason: 'socket_not_ready' };
    }

    if (socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(payload);
        return { status: 'sent' };
      } catch {
        return canBuffer ? enqueueOutbound(payload) : { status: 'dropped', reason: 'send_failed' };
      }
    }

    if (socket.readyState === WebSocket.CONNECTING) {
      return canBuffer
        ? enqueueOutbound(payload)
        : { status: 'dropped', reason: 'socket_connecting' };
    }

    connect();
    return canBuffer ? enqueueOutbound(payload) : { status: 'dropped', reason: 'socket_not_open' };
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
