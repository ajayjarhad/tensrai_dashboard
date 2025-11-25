import { getEnv } from '@tensrai/shared';

type WsEvent =
  | { type: 'event'; channel: string; data: unknown }
  | { type: 'error'; channel?: string; message: string }
  | { type: 'response'; channel: string; requestId?: string; data: unknown };

type EventHandler = (event: WsEvent) => void;
type StatusHandler = (status: ConnectionStatus) => void;

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

const getWsBaseUrl = () => {
  const apiBase = getEnv('VITE_API_URL', 'http://localhost:5001');
  if (apiBase.startsWith('ws')) return apiBase;
  if (apiBase.startsWith('http')) {
    return apiBase.replace(/^http/, 'ws');
  }
  return `ws://${apiBase}`;
};

export const createRobotWsClient = (robotId: string) => {
  let socket: WebSocket | null = null;
  let status: ConnectionStatus = 'disconnected';
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const eventHandlers = new Set<EventHandler>();
  const statusHandlers = new Set<StatusHandler>();

  const wsUrl = `${getWsBaseUrl()}/ws/robots/${robotId}`;

  const notifyStatus = (next: ConnectionStatus) => {
    status = next;
    statusHandlers.forEach(handler => handler(next));
  };

  const connect = () => {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    notifyStatus('connecting');
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      reconnectAttempts = 0;
      notifyStatus('connected');
    };

    socket.onmessage = event => {
      try {
        const parsed = JSON.parse(event.data as string) as WsEvent;
        eventHandlers.forEach(handler => handler(parsed));
      } catch {
        // ignore malformed messages
      }
    };

    socket.onerror = () => {
      notifyStatus('error');
    };

    socket.onclose = () => {
      notifyStatus('disconnected');
      scheduleReconnect();
    };
  };

  const disconnect = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    socket?.close();
    socket = null;
  };

  const scheduleReconnect = () => {
    if (reconnectTimer) return;
    const delay = Math.min(1000 * 2 ** reconnectAttempts, 10000);
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const sendCommand = (channel: string, data: unknown) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const payload = JSON.stringify({ type: 'command', channel, data });
    socket.send(payload);
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
