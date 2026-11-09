import type { FastifyInstance, FastifyRequest } from 'fastify';
import { websocketMetrics } from '../metrics/index.js';
import {
  auditRobotCommand,
  clientFrameText,
  clientSocketOf,
  closeWhenAccessEnds,
  createClientSender,
  makeError,
} from './gatewaySocket.js';

const requestIdOf = (frame: { requestId?: unknown } | null | undefined) =>
  typeof frame?.requestId === 'string' ? frame.requestId : undefined;

export const createEmergencySocketHandler =
  (fastify: FastifyInstance) => async (connection: any, request: FastifyRequest) => {
    const { robotId } = request.params as { robotId: string };
    const emergencyRegistry = fastify.emergencyRegistry;

    const clientSocket = clientSocketOf(connection);

    if (!clientSocket) {
      fastify.log.error({ robotId }, 'Emergency proxy WebSocket upgrade failed: no client socket');
      return;
    }

    if (!emergencyRegistry) {
      clientSocket.send(makeError(undefined, undefined, 'Emergency registry unavailable'));
      clientSocket.close();
      return;
    }

    closeWhenAccessEnds(fastify, clientSocket, request, robotId);

    let closed = false;

    const safeClientSend = createClientSender(
      fastify.log,
      clientSocket,
      robotId,
      'emergency',
      'Failed to send emergency proxy message to dashboard'
    );

    const unsubscribeEmergencyEvents = emergencyRegistry.addRobotEventListener(
      robotId,
      (payloadText: string) => {
        websocketMetrics.messagesReceived.add(1, {
          'robot.id': robotId,
          'websocket.type': 'emergency-proxy',
          'message.source': 'emergency_registry',
        });
        safeClientSend(payloadText);
      }
    );

    try {
      safeClientSend(emergencyRegistry.getRobotSnapshotEvent(robotId));
    } catch (err) {
      fastify.log.warn({ robotId, err }, 'Failed to send initial emergency snapshot');
    }

    const closeClient = () => {
      if (closed) return;
      closed = true;
      unsubscribeEmergencyEvents();
      try {
        clientSocket.close();
      } catch {}
    };

    clientSocket.on('message', (raw: Buffer | string) => {
      const payloadText = clientFrameText(raw);
      websocketMetrics.messagesReceived.add(1, {
        'robot.id': robotId,
        'websocket.type': 'emergency-proxy',
        'message.source': 'dashboard_client',
      });

      let parsed: any;
      try {
        parsed = JSON.parse(payloadText);
      } catch {
        safeClientSend(makeError(undefined, undefined, 'Invalid JSON message'));
        return;
      }

      const requestId = requestIdOf(parsed);
      const eventName = parsed?.event ?? parsed?.type;
      if (eventName !== 'SOFTWARE_EMERGENCY') {
        safeClientSend(makeError(undefined, requestId, 'Unsupported emergency websocket message'));
        return;
      }

      const desiredStatus = parsed?.payload?.status;
      if (typeof desiredStatus !== 'boolean') {
        safeClientSend(
          makeError(undefined, requestId, 'SOFTWARE_EMERGENCY payload.status must be boolean')
        );
        return;
      }

      void auditRobotCommand(fastify, request, 'SOFTWARE_EMERGENCY', {
        robotId,
        status: desiredStatus,
      });
      const sendResult = emergencyRegistry.sendSoftwareEmergency(robotId, desiredStatus);
      if (!sendResult.ok) {
        safeClientSend(
          makeError(undefined, requestId, sendResult.error ?? 'Emergency bridge not connected')
        );
      }
    });

    clientSocket.on('close', () => {
      closeClient();
    });

    clientSocket.on('error', (err: unknown) => {
      websocketMetrics.connectionErrors.add(1, {
        'robot.id': robotId,
        'websocket.type': 'emergency-proxy',
        'error.reason': 'client_socket_error',
      });
      fastify.log.error({ robotId, err }, 'Emergency proxy dashboard WebSocket error');
      closeClient();
    });
  };
