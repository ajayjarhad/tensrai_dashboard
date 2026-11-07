import {
  extractMissionCommandId,
  parseRobotMissionEvent,
  type RobotMissionEvent,
  withMissionCommandId,
} from '@tensrai/shared';
import { resolveWsBaseUrl } from '@/lib/api';
import { generateRequestId } from '@/lib/utils/utils';
import { createReconnectingSocket, frameText } from './reconnectingSocket';

export type SendEventResult = {
  accepted: boolean;
  queued: boolean;
  reason?: string;
  commandId?: string;
};

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
  const wsUrl = `${resolveWsBaseUrl()}/ws/robots/${robotId}/mapping/${encodeURIComponent(
    `mapping-${robotId}`
  )}`;

  const connection = createReconnectingSocket<RobotMissionEvent>({
    createSocket: () => new WebSocket(wsUrl),
    parseFrame: (data, status) => {
      if (status !== 'connected') return undefined;
      const rawText = frameText(data);
      const eventName = extractEventName(rawText);
      if (!eventName || !MISSION_EVENTS.has(eventName)) return undefined;
      return parseRobotMissionEvent(JSON.parse(rawText)) ?? undefined;
    },
  });

  const sendEvent = (event: string, payload: unknown = {}): SendEventResult => {
    const commandId = extractMissionCommandId({ payload }) ?? generateRequestId();
    const normalizedPayload = withMissionCommandId(payload, commandId);
    const message = JSON.stringify({
      type: 'command',
      event,
      commandId,
      payload: normalizedPayload,
    });

    if (connection.isStopped()) {
      return { accepted: false, queued: false, reason: 'client_disconnected', commandId };
    }

    if (!connection.sendOrConnect(message)) {
      return { accepted: true, queued: false, commandId };
    }

    connection.enqueue(message);
    return { accepted: true, queued: true, commandId };
  };

  return {
    connect: connection.connect,
    disconnect: connection.disconnect,
    sendEvent,
    addEventListener: connection.addEventListener,
    addStatusListener: connection.addStatusListener,
    getStatus: connection.getStatus,
  };
};
