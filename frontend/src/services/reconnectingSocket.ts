export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';
type SendFailure = 'socket_not_ready' | 'send_failed' | 'socket_connecting' | 'socket_not_open';

const CONNECT_TIMEOUT_MS = 8_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 10_000;
const MAX_OUTBOUND_QUEUE = 100;

type ReconnectingSocketOptions<TEvent, TExtraStatus extends string> = {
  // Returning null reports 'error' without retrying; throwing propagates to the caller of connect.
  createSocket: () => WebSocket | null;
  // Returning undefined hides a frame from listeners.
  parseFrame: (data: unknown, status: ConnectionStatus | TExtraStatus) => TEvent | undefined;
  // A status here stops the connection attempt before it starts.
  blockedStatus?: () => ConnectionStatus | TExtraStatus | null;
};

export const frameText = (data: unknown) => {
  if (typeof data === 'string') return data;
  return data instanceof Blob ? '' : String(data ?? '');
};

export const createReconnectingSocket = <TEvent, TExtraStatus extends string = never>({
  createSocket,
  parseFrame,
  blockedStatus,
}: ReconnectingSocketOptions<TEvent, TExtraStatus>) => {
  type Status = ConnectionStatus | TExtraStatus;

  let socket: WebSocket | null = null;
  let status: Status = 'disconnected';
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let connectTimer: ReturnType<typeof setTimeout> | null = null;
  let shouldReconnect = true;
  const outboundQueue: string[] = [];
  const eventHandlers = new Set<(event: TEvent) => void>();
  const statusHandlers = new Set<(status: Status) => void>();

  const notifyStatus = (next: Status) => {
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
    }, CONNECT_TIMEOUT_MS);
  };

  const scheduleReconnect = () => {
    if (!shouldReconnect || reconnectTimer) return;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempts, RECONNECT_MAX_MS);
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
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

    const blocked = blockedStatus?.();
    if (blocked) {
      notifyStatus(blocked);
      return;
    }

    notifyStatus('connecting');
    const created = createSocket();
    if (!created) {
      notifyStatus('error');
      return;
    }
    socket = created;
    scheduleConnectTimeout();

    created.onopen = () => {
      clearConnectTimer();
      reconnectAttempts = 0;
      notifyStatus('connected');
      flushOutbound();
    };

    created.onmessage = (event: MessageEvent) => {
      try {
        const parsed = parseFrame(event.data, status);
        if (parsed === undefined) return;
        eventHandlers.forEach(handler => {
          handler(parsed);
        });
      } catch {
        // A malformed frame or a throwing listener must not take the socket down.
      }
    };

    created.onerror = () => {
      notifyStatus('error');
    };

    created.onclose = () => {
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

  const enqueue = (payload: string) => {
    if (outboundQueue.length >= MAX_OUTBOUND_QUEUE) {
      // Drop the oldest so the queue stays bounded during long disconnects.
      outboundQueue.shift();
    }
    outboundQueue.push(payload);
  };

  const sendIfOpen = (payload: string) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    try {
      socket.send(payload);
      return true;
    } catch {
      return false;
    }
  };

  // Returns why the payload did not go, or null when it did. Callers decide whether to queue it.
  const sendOrConnect = (payload: string): SendFailure | null => {
    if (!socket) {
      connect();
      return 'socket_not_ready';
    }
    if (socket.readyState === WebSocket.OPEN) return sendIfOpen(payload) ? null : 'send_failed';
    if (socket.readyState === WebSocket.CONNECTING) return 'socket_connecting';
    connect();
    return 'socket_not_open';
  };

  const addEventListener = (handler: (event: TEvent) => void) => {
    eventHandlers.add(handler);
    return () => eventHandlers.delete(handler);
  };

  const addStatusListener = (handler: (status: Status) => void) => {
    statusHandlers.add(handler);
    handler(status);
    return () => statusHandlers.delete(handler);
  };

  return {
    connect,
    disconnect,
    enqueue,
    sendIfOpen,
    sendOrConnect,
    addEventListener,
    addStatusListener,
    getStatus: () => status,
    isStopped: () => !shouldReconnect,
    readyState: () => socket?.readyState ?? null,
    bufferedAmount: () => socket?.bufferedAmount ?? null,
  };
};
