import {
  extractMissionCommandId,
  parseRobotMissionEvent,
  type RobotMissionEvent,
  withMissionCommandId,
} from '@tensrai/shared';
import { resolveWsBaseUrl } from '@/lib/api';
import { generateRequestId } from '@/lib/utils/utils';

type EventHandler = (event: RobotMissionEvent) => void;
type StatusHandler = (status: ConnectionStatus) => void;

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';
export type SendEventResult = {
  accepted: boolean;
  queued: boolean;
  reason?: string;
  commandId?: string;
};

const MAX_OUTBOUND_QUEUE = 100;
const MISSION_EVENTS = new Set([
  'MISSION_CONTROL_ACK',
  'MISSION_START_ACK',
  'MISSION_COMPLETED',
  'WAYPOINT_ACK',
  'MODE_CHANGE_ACK',
  'ROBOT_STATUS_UPDATE',
]);

const extractEventName = (message: string): string | null => {
  const match = message.match(/"event"\s*:\s*"([A-Z_]+)"/);
  if (!match || match.length < 2) return null;
  return match[1];
};

export const createRobotMappingWsClient = (robotId: string) => {
  let socket: WebSocket | null = null;
  let status: ConnectionStatus = 'disconnected';
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let connectTimer: ReturnType<typeof setTimeout> | null = null;
  let shouldReconnect = true;
  const outboundQueue: string[] = [];
  const eventHandlers = new Set<EventHandler>();
  const statusHandlers = new Set<StatusHandler>();

  const wsUrl = `${resolveWsBaseUrl()}/ws/robots/${robotId}/mapping/${encodeURIComponent(
    `mapping-${robotId}`
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

  const scheduleReconnect = () => {
    if (!shouldReconnect || reconnectTimer) return;
    const delay = Math.min(1000 * 2 ** reconnectAttempts, 10000);
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const enqueueOutbound = (message: string, commandId?: string): SendEventResult => {
    if (outboundQueue.length >= MAX_OUTBOUND_QUEUE) {
      // Drop oldest command to keep memory bounded during prolonged disconnects.
      outboundQueue.shift();
    }
    outboundQueue.push(message);
    return {
      accepted: true,
      queued: true,
      ...(commandId ? { commandId } : {}),
    };
  };

  const flushOutbound = () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    while (outboundQueue.length > 0) {
      const next = outboundQueue.shift();
      if (!next) continue;
      try {
        socket.send(next);
      } catch {
        outboundQueue.unshift(next);
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

    socket.onmessage = (event: MessageEvent) => {
      if (status !== 'connected') return;
      const rawText =
        typeof event.data === 'string'
          ? event.data
          : event.data instanceof Blob
            ? ''
            : String(event.data ?? '');

      const eventName = extractEventName(rawText);
      if (!eventName || !MISSION_EVENTS.has(eventName)) return;

      try {
        const raw = JSON.parse(rawText);
        const parsed = parseRobotMissionEvent(raw);
        if (!parsed) return;
        eventHandlers.forEach(handler => {
          handler(parsed);
        });
      } catch {
        // Ignore malformed frames from upstream bridges.
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

  const sendEvent = (event: string, payload: unknown = {}): SendEventResult => {
    const commandId = extractMissionCommandId({ payload }) ?? generateRequestId();
    const normalizedPayload = withMissionCommandId(payload, commandId);
    const message = JSON.stringify({
      type: 'command',
      event,
      commandId,
      payload: normalizedPayload,
    });

    if (!shouldReconnect) {
      return {
        accepted: false,
        queued: false,
        reason: 'client_disconnected',
        ...(commandId ? { commandId } : {}),
      };
    }

    if (!socket) {
      connect();
      return enqueueOutbound(message, commandId);
    }

    if (socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(message);
        return {
          accepted: true,
          queued: false,
          ...(commandId ? { commandId } : {}),
        };
      } catch {
        return enqueueOutbound(message, commandId);
      }
    }

    if (socket.readyState === WebSocket.CONNECTING) {
      return enqueueOutbound(message, commandId);
    }

    connect();
    return enqueueOutbound(message, commandId);
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
    sendEvent,
    addEventListener,
    addStatusListener,
    getStatus: () => status,
  };
};
