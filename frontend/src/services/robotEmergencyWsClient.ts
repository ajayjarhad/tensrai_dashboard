import { parseRobotEmergencyEvent, type RobotEmergencyBridgeEvent } from '@tensrai/shared';
import { resolveWsBaseUrl } from '@/lib/api';

type EventHandler = (event: RobotEmergencyBridgeEvent) => void;
type StatusHandler = (status: ConnectionStatus) => void;
type EmergencyWsClientOptions = {
  robotId: string;
  robotName?: string | undefined;
  ipAddress?: string | undefined;
  emergencyBridgePort?: number | undefined;
};

export type ConnectionStatus =
  | 'unconfigured'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

const DEFAULT_EMERGENCY_PORT = 8766;

const parseBooleanFlag = (raw: string | undefined, fallback: boolean) => {
  if (raw === undefined || raw === null) return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const resolveCloudDashboardFlag = () =>
  parseBooleanFlag(import.meta.env['VITE_CLOUD_DASHBOARD'], true);

const CLOUD_DASHBOARD = resolveCloudDashboardFlag();

export const isEmergencyViaBackend = () => CLOUD_DASHBOARD;

const resolveEmergencyWsUrl = (options: EmergencyWsClientOptions): string | null => {
  const labelSource = options.robotName?.trim() || options.robotId;
  const label = encodeURIComponent(`emergency-${labelSource}`);

  if (CLOUD_DASHBOARD) {
    const base = resolveWsBaseUrl();
    return `${base}/ws/robots/${encodeURIComponent(options.robotId)}/emergency/${label}`;
  }

  if (!options.ipAddress) return null;
  const base = resolveWsBaseUrl();
  const protocol = base.startsWith('wss://') ? 'wss' : 'ws';
  const port = options.emergencyBridgePort ?? DEFAULT_EMERGENCY_PORT;
  return `${protocol}://${options.ipAddress}:${port}/dashboard/${label}`;
};

const isValidWsUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'ws:' || parsed.protocol === 'wss:';
  } catch {
    return false;
  }
};

export const createRobotEmergencyWsClient = (options: EmergencyWsClientOptions) => {
  let socket: WebSocket | null = null;
  let status: ConnectionStatus = 'disconnected';
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let connectTimer: ReturnType<typeof setTimeout> | null = null;
  let shouldReconnect = true;
  const eventHandlers = new Set<EventHandler>();
  const statusHandlers = new Set<StatusHandler>();

  const wsUrl = resolveEmergencyWsUrl(options);

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

    if (!wsUrl) {
      notifyStatus('unconfigured');
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
          ...(CLOUD_DASHBOARD ? { type: 'SOFTWARE_EMERGENCY' } : { event: 'SOFTWARE_EMERGENCY' }),
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
    getUrl: () => wsUrl ?? '',
  };
};
