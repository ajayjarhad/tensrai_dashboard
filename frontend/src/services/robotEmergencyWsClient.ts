import { parseRobotEmergencyEvent, type RobotEmergencyBridgeEvent } from '@tensrai/shared';
import { resolveWsBaseUrl } from '@/lib/api';
import { createReconnectingSocket, frameText } from './reconnectingSocket';

type EmergencyWsClientOptions = {
  robotId: string;
  robotName?: string | undefined;
  ipAddress?: string | undefined;
  emergencyBridgePort?: number | undefined;
};

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
  const wsUrl = resolveEmergencyWsUrl(options);

  const connection = createReconnectingSocket<RobotEmergencyBridgeEvent, 'unconfigured'>({
    blockedStatus: () => {
      if (!wsUrl) return 'unconfigured';
      return isValidWsUrl(wsUrl) ? null : 'error';
    },
    createSocket: () => {
      try {
        // blockedStatus has already ruled out a missing URL.
        return new WebSocket(wsUrl as string);
      } catch {
        return null;
      }
    },
    parseFrame: data => parseRobotEmergencyEvent(JSON.parse(frameText(data))) ?? undefined,
  });

  const sendSoftwareEmergency = (desiredStatus: boolean) =>
    connection.sendIfOpen(
      JSON.stringify({
        ...(CLOUD_DASHBOARD ? { type: 'SOFTWARE_EMERGENCY' } : { event: 'SOFTWARE_EMERGENCY' }),
        payload: { status: desiredStatus },
      })
    );

  return {
    connect: connection.connect,
    disconnect: connection.disconnect,
    sendSoftwareEmergency,
    addEventListener: connection.addEventListener,
    addStatusListener: connection.addStatusListener,
    getStatus: connection.getStatus,
    isOpen: () => connection.readyState() === WebSocket.OPEN,
    getUrl: () => wsUrl ?? '',
  };
};
