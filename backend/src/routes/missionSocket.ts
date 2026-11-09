import {
  isRobotMissionCommandEvent,
  parseRobotMissionCommand,
  type RobotMissionCommand,
  type RobotMissionPayload,
  withMissionCommandId,
} from '@tensrai/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { websocketMetrics } from '../metrics/index.js';
import { buildMissionFailureAck } from '../services/missionStatus.js';
import {
  auditRobotCommand,
  clientFrameText,
  clientSocketOf,
  closeWhenAccessEnds,
  createClientSender,
  makeError,
} from './gatewaySocket.js';

export const createMissionSocketHandler =
  (fastify: FastifyInstance) => async (connection: any, request: FastifyRequest) => {
    const { robotId } = request.params as { robotId: string };
    const missionRegistry = fastify.missionRegistry;

    const clientSocket = clientSocketOf(connection);

    if (!clientSocket) {
      fastify.log.error({ robotId }, 'Unified mapping WebSocket upgrade failed: no client socket');
      return;
    }

    if (!missionRegistry) {
      clientSocket.send(makeError(undefined, undefined, 'Mission registry unavailable'));
      clientSocket.close();
      return;
    }

    fastify.log.info({ robotId }, 'Dashboard client connected to mission websocket');
    closeWhenAccessEnds(fastify, clientSocket, request, robotId);

    let closed = false;

    const safeClientSend = createClientSender(
      fastify.log,
      clientSocket,
      robotId,
      'mapping',
      'Failed to send message to dashboard client'
    );

    const unsubscribeMissionEvents = missionRegistry.addRobotEventListener(
      robotId,
      (payloadText: string) => {
        websocketMetrics.messagesReceived.add(1, {
          'robot.id': robotId,
          'websocket.type': 'unified-mapping',
          'message.source': 'mission_registry',
        });
        safeClientSend(payloadText);
      }
    );

    const closeClient = () => {
      if (closed) return;
      closed = true;
      unsubscribeMissionEvents();
      try {
        clientSocket.close();
      } catch {}
    };

    const replyNotForwarded = (
      command: RobotMissionCommand,
      payload: RobotMissionPayload | undefined,
      error: string
    ) => {
      fastify.log.warn(
        { robotId, event: command.event, commandId: command.commandId ?? null, error },
        'Mission command could not be forwarded to mission bridge'
      );
      const failureAck = buildMissionFailureAck(command.event, payload, error);
      safeClientSend(
        JSON.stringify({
          ...failureAck,
          commandId: command.commandId,
          payload: withMissionCommandId(failureAck.payload, command.commandId),
        })
      );
    };

    const persistCommandIntent = (
      command: RobotMissionCommand,
      payload: RobotMissionPayload | undefined
    ) => {
      try {
        if (missionRegistry.recordCommandIntent) {
          void missionRegistry
            .recordCommandIntent(robotId, command.event, payload)
            .catch((error: unknown) => {
              fastify.log.warn({ robotId, error }, 'Failed to persist mission command intent');
            });
        }
      } catch (err) {
        fastify.log.error({ robotId, err }, 'Failed to persist mission command intent');
      }
    };

    const forwardCommand = (command: RobotMissionCommand) => {
      fastify.log.info(
        { robotId, event: command.event, commandId: command.commandId ?? null },
        'Forwarding dashboard mission command to mission bridge'
      );
      const payload = withMissionCommandId(command.payload, command.commandId);
      const serializedCommand = JSON.stringify({ event: command.event, payload });
      void auditRobotCommand(fastify, request, 'MISSION_COMMAND', {
        robotId,
        event: command.event,
      });
      const sendResult = missionRegistry.sendCommand(robotId, serializedCommand);
      if (!sendResult.ok) {
        replyNotForwarded(command, payload, sendResult.error ?? 'Mission bridge not connected');
        return;
      }
      persistCommandIntent(command, payload);
    };

    clientSocket.on('message', (msg: Buffer | string) => {
      const payloadText = clientFrameText(msg);
      websocketMetrics.messagesReceived.add(1, {
        'robot.id': robotId,
        'websocket.type': 'unified-mapping',
        'message.source': 'dashboard_client',
      });

      let rawMessage: unknown;
      try {
        rawMessage = JSON.parse(payloadText);
      } catch {
        safeClientSend(makeError(undefined, undefined, 'Invalid JSON message'));
        return;
      }

      const parsed = parseRobotMissionCommand(rawMessage);

      if (parsed?.event && isRobotMissionCommandEvent(parsed.event)) {
        forwardCommand(parsed);
        return;
      }

      safeClientSend(makeError(undefined, undefined, 'Unsupported mapping websocket message'));
    });

    clientSocket.on('close', () => {
      fastify.log.info({ robotId }, 'Dashboard client disconnected from mission websocket');
      closeClient();
    });

    clientSocket.on('error', (err: unknown) => {
      websocketMetrics.connectionErrors.add(1, {
        'robot.id': robotId,
        'websocket.type': 'unified-mapping',
        'error.reason': 'client_socket_error',
      });
      fastify.log.error({ robotId, err }, 'Dashboard WebSocket error');
      closeClient();
    });
  };
