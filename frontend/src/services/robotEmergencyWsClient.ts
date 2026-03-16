import { parseRobotEmergencyEvent, type RobotEmergencyBridgeEvent } from '@tensrai/shared';

type EventHandler = (event: RobotEmergencyBridgeEvent) => void;
type StatusHandler = (status: ConnectionStatus) => void;
type EmergencyWsClientOptions = {
  robotId: string;
  robotName?: string | undefined;
};

export type ConnectionStatus =
  | 'unconfigured'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

const resolveEmergencyWsUrl = (
  ipAddress: string,
  port: number,
  options: EmergencyWsClientOptions
) => {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const labelSource = options.robotName?.trim() || options.robotId;
  const label = encodeURIComponent(`emergency-${labelSource}`);
  return `${protocol}://${ipAddress}:${port}/dashboard/${label}`;
};

const isValidWsUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'ws:' || parsed.protocol === 'wss:';
  } catch {
    return false;
  }
};

export const createRobotEmergencyWsClient = (
  ipAddress: string,
  port: number,
  options: EmergencyWsClientOptions
) => {
  let socket: WebSocket | null = null;
  let status: ConnectionStatus = 'disconnected';
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let connectTimer: ReturnType<typeof setTimeout> | null = null;
  let shouldReconnect = true;
  const eventHandlers = new Set<EventHandler>();
  const statusHandlers = new Set<StatusHandler>();

  const wsUrl = resolveEmergencyWsUrl(ipAddress, port, options);

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
    }, 8_000);
  };

  const scheduleReconnect = () => {
    if (!shouldReconnect || reconnectTimer) return;
    const delay = Math.min(1_000 * 2 ** reconnectAttempts, 10_000);
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const connect = () => {
    shouldReconnect = true;
    if (
      socket &&
      (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    if (!isValidWsUrl(wsUrl)) {
      notifyStatus('error');
      return;
    }

    notifyStatus('connecting');
    try {
      socket = new WebSocket(wsUrl);
    } catch {
      notifyStatus('error');
      return;
    }
    scheduleConnectTimeout();

    socket.onopen = () => {
      clearConnectTimer();
      reconnectAttempts = 0;
      notifyStatus('connected');
    };

    socket.onmessage = (event: MessageEvent) => {
      const rawText =
        typeof event.data === 'string'
          ? event.data
          : event.data instanceof Blob
            ? ''
            : String(event.data ?? '');

      try {
        const parsed = parseRobotEmergencyEvent(JSON.parse(rawText));
        if (!parsed) return;
        eventHandlers.forEach(handler => {
          handler(parsed);
        });
      } catch {
        // Ignore malformed frames from upstream emergency bridge.
      }
    };

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

  const sendSoftwareEmergency = (desiredStatus: boolean) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    try {
      socket.send(
        JSON.stringify({
          event: 'SOFTWARE_EMERGENCY',
          payload: { status: desiredStatus },
        })
      );
      return true;
    } catch {
      return false;
    }
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
    sendSoftwareEmergency,
    addEventListener,
    addStatusListener,
    getStatus: () => status,
    isOpen: () => socket?.readyState === WebSocket.OPEN,
    getUrl: () => wsUrl,
  };
};
