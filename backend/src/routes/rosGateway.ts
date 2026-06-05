// @ts-nocheck
import websocket from '@fastify/websocket';
import { trace } from '@opentelemetry/api';
import { parseRobotMissionCommand, withMissionCommandId } from '@tensrai/shared';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import WebSocket from 'ws';
import { websocketMetrics } from '../metrics/index.js';
import { buildMissionFailureAck, isMissionControlEvent } from '../services/missionStatus.js';
import { RosRegistry } from '../services/rosRegistry.js';

type IncomingMessage =
  | {
      type: 'command';
      channel: string;
      commandId?: string;
      sentAtMs?: number;
      data: unknown;
    }
  | {
      type: 'request';
      channel: 'asset';
      requestId: string;
      data: {
        asset: string;
        robotId?: string;
      };
    };

const makeError = (channel: string | undefined, requestId: string | undefined, message: string) =>
  JSON.stringify({
    type: 'error',
    channel,
    requestId,
    message,
  });

const makeEvent = (channel: string, data: unknown) =>
  JSON.stringify({
    type: 'event',
    channel,
    data,
  });

const ROS_COMMAND_LOG_INTERVAL_MS = (() => {
  const raw = Number(process.env['ROS_COMMAND_LOG_INTERVAL_MS'] ?? 2000);
  if (!Number.isFinite(raw) || raw < 0) return 2000;
  return raw;
})();

type ForwardableChannelEvent = {
  channel: string;
  data: unknown;
  __serializedMessage?: string;
};

const rosGateway = async (fastify: FastifyInstance) => {
  const registry = new RosRegistry(fastify.prisma, fastify.log);
  fastify.decorate('rosRegistry', registry);

  registry.reloadFromDb().catch(error => {
    fastify.log.error({ error }, 'Failed to load ROS registry from DB');
  });

  await fastify.register(websocket);

  // Track active WebSocket connections
  let _activeConnections = 0;
  const rosCommandLogState = new Map<string, { lastAt: number; suppressed: number }>();

  const logRosCommand = (
    level: 'info' | 'warn' | 'error',
    stage: 'received' | 'published' | 'rejected',
    fields: Record<string, unknown>
  ) => {
    const channel = typeof fields['channel'] === 'string' ? fields['channel'] : 'unknown';
    const robotId = typeof fields['robotId'] === 'string' ? fields['robotId'] : 'unknown';
    const shouldThrottle =
      channel === 'teleop' && stage !== 'rejected' && ROS_COMMAND_LOG_INTERVAL_MS > 0;
    const key = `${robotId}:${channel}:${stage}`;
    let suppressed = 0;

    if (shouldThrottle) {
      const now = Date.now();
      const state = rosCommandLogState.get(key) ?? { lastAt: 0, suppressed: 0 };
      if (now - state.lastAt < ROS_COMMAND_LOG_INTERVAL_MS) {
        state.suppressed += 1;
        rosCommandLogState.set(key, state);
        return;
      }
      suppressed = state.suppressed;
      rosCommandLogState.set(key, { lastAt: now, suppressed: 0 });
    }

    fastify.log[level](
      {
        ...fields,
        stage,
        ...(suppressed ? { suppressedSinceLastLog: suppressed } : {}),
      },
      `ROS bridge command ${stage}`
    );
  };

  const robotBridgeHandler = (connection, request) => {
    const { robotId } = request.params as { robotId: string };
    const tracer = trace.getTracer('ros-gateway');
    const span = tracer.startSpan('websocket.robot.connection', {
      attributes: {
        'robot.id': robotId,
        'websocket.type': 'ros-bridge',
      },
    });
    const spanStartedAt = Date.now();

    // Increment active connections
    _activeConnections++;
    // Note: activeConnections metric removed due to Bun runtime compatibility issues

    let manager = registry.getManager(robotId);

    if (!manager) {
      websocketMetrics.connectionErrors.add(1, {
        'robot.id': robotId,
        'websocket.type': 'ros-bridge',
        'error.reason': 'robot_not_found',
      });

      span.setAttributes({
        'websocket.connection.success': false,
        'websocket.error.reason': 'robot_not_found',
      });
      span.end();

      connection.socket?.send?.(makeError(undefined, undefined, `Unknown robot: ${robotId}`));
      connection.socket?.close?.();

      _activeConnections--;
      // Note: activeConnections metric removed due to Bun runtime compatibility issues
      return;
    }

    // @fastify/websocket normally puts the WS on connection.socket (Node),
    // but Bun exposes it as conn/ws. Keep fallbacks so future WS routes work across runtimes.
    const socket =
      (connection as any).socket ??
      (connection as any).conn ??
      (connection as any).ws ??
      (connection as any).webSocket ??
      (typeof connection.send === 'function' ? (connection as any) : undefined);

    if (!socket) {
      fastify.log.error(
        {
          robotId,
          connectionKeys: Object.keys(connection || {}),
        },
        'WebSocket upgrade failed: no socket on connection'
      );
      return;
    }

    const forward = (event: ForwardableChannelEvent) => {
      try {
        let message = event.__serializedMessage;
        if (!message) {
          message = makeEvent(event.channel, event.data);
          event.__serializedMessage = message;
        }
        socket.send(message);
      } catch (err) {
        fastify.log.error({ err }, 'Failed to forward ROS event');
      }
    };

    let attachedManager: any;
    const attachManager = (nextManager: any) => {
      if (!nextManager || attachedManager === nextManager) return;
      attachedManager?.off?.('channel-data', forward);
      attachedManager = nextManager;
      attachedManager.on('channel-data', forward);

      for (const event of attachedManager.getLatestChannelEvents()) {
        forward({
          channel: event.channel,
          data: event.data,
        });
      }
    };

    attachManager(manager);

    socket.on('message', async buffer => {
      let parsed: IncomingMessage;
      try {
        parsed = JSON.parse(buffer.toString());
      } catch {
        websocketMetrics.connectionErrors.add(1, {
          'robot.id': robotId,
          'websocket.type': 'ros-bridge',
          'error.reason': 'invalid_json',
        });
        socket.send(makeError(undefined, undefined, 'Invalid JSON message'));
        return;
      }

      // Track incoming messages
      websocketMetrics.messagesReceived.add(1, {
        'robot.id': robotId,
        'websocket.type': 'ros-bridge',
        'message.type': parsed.type,
        'message.channel': parsed.channel || 'unknown',
      });

      if (parsed.type === 'command') {
        logRosCommand('info', 'received', {
          robotId,
          channel: parsed.channel,
          commandId: parsed.commandId ?? null,
          sentAtMs: parsed.sentAtMs ?? null,
          ageMs: typeof parsed.sentAtMs === 'number' ? Date.now() - parsed.sentAtMs : null,
          managerAttached: Boolean(attachedManager),
        });
        const currentManager = registry.getManager(robotId);
        if (!currentManager) {
          logRosCommand('warn', 'rejected', {
            robotId,
            channel: parsed.channel,
            commandId: parsed.commandId ?? null,
            reason: 'robot_not_found',
          });
          socket.send(makeError(parsed.channel, parsed.commandId, `Unknown robot: ${robotId}`));
          return;
        }
        manager = currentManager;
        attachManager(manager);
        const result = manager.handleCommand(parsed.channel, parsed.data);
        if (!result.ok) {
          logRosCommand('warn', 'rejected', {
            robotId,
            channel: parsed.channel,
            commandId: parsed.commandId ?? null,
            error: result.error ?? 'Command failed',
            result,
          });
          socket.send(
            makeError(parsed.channel, parsed.commandId, result.error ?? 'Command failed')
          );
          return;
        }
        logRosCommand('info', 'published', {
          robotId,
          channel: parsed.channel,
          commandId: parsed.commandId ?? null,
          result,
        });
        return;
      }

      if (parsed.type === 'request' && parsed.channel === 'asset') {
        const requestId = parsed.requestId;
        socket.send(
          makeError('asset', requestId, 'Asset channel disabled; use HTTP or enable later')
        );
        return;
      }

      socket.send(makeError(undefined, undefined, 'Unsupported message type'));
    });

    socket.on('close', () => {
      attachedManager?.off?.('channel-data', forward);

      // Decrement active connections
      _activeConnections--;
      // Note: activeConnections metric removed due to Bun runtime compatibility issues

      span.setAttributes({
        'websocket.connection.established': true,
        'websocket.connection.duration_ms': Date.now() - spanStartedAt,
      });
      span.end();
    });

    socket.on('error', error => {
      websocketMetrics.connectionErrors.add(1, {
        'robot.id': robotId,
        'websocket.type': 'ros-bridge',
        'error.reason': 'socket_error',
        'error.message': error.message,
      });

      span.setAttributes({
        'websocket.connection.success': false,
        'websocket.error.reason': 'socket_error',
        'websocket.error.message': error.message,
      });
      span.recordException(error);
    });
  };

  fastify.get('/ws/robots/:robotId', { websocket: true }, robotBridgeHandler);
  fastify.get('/ws/robots/:robotId/telemetry/:label', { websocket: true }, robotBridgeHandler);

  fastify.get('/health/ros', async () => {
    return {
      robots: registry.getStatuses(),
      missions: (fastify as any).missionRegistry?.getStatuses?.() ?? [],
    };
  });

  const unifiedMappingHandler = async (connection, request) => {
    const { robotId } = request.params as { robotId: string };
    const missionRegistry = (fastify as any).missionRegistry;

    const clientSocket =
      (connection as any).socket ??
      (connection as any).conn ??
      (connection as any).ws ??
      (connection as any).webSocket ??
      (typeof connection.send === 'function' ? (connection as any) : undefined);

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

    let closed = false;

    const stringifyMessage = (data: unknown) => {
      if (typeof data === 'string') return data;
      if (Buffer.isBuffer(data)) return data.toString('utf8');
      return String(data);
    };

    const safeClientSend = (message: string) => {
      if (clientSocket.readyState !== WebSocket.OPEN) return;
      try {
        clientSocket.send(message);
      } catch (err) {
        fastify.log.error({ robotId, err }, 'Failed to send message to dashboard client');
      }
    };

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

    clientSocket.on('message', (msg: Buffer | string) => {
      const payloadText = stringifyMessage(msg);
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

      if (parsed?.event && isMissionControlEvent(parsed.event)) {
        fastify.log.info(
          { robotId, event: parsed.event, commandId: parsed.commandId ?? null },
          'Forwarding dashboard mission command to mission bridge'
        );
        const serializedCommand = JSON.stringify({
          event: parsed.event,
          payload: withMissionCommandId(parsed.payload, parsed.commandId),
        });
        const sendResult = missionRegistry.sendCommand(robotId, serializedCommand);
        if (!sendResult.ok) {
          fastify.log.warn(
            {
              robotId,
              event: parsed.event,
              commandId: parsed.commandId ?? null,
              error: sendResult.error ?? 'Mission bridge not connected',
            },
            'Mission command could not be forwarded to mission bridge'
          );
          const failureAck = buildMissionFailureAck(
            parsed.event,
            withMissionCommandId(parsed.payload, parsed.commandId),
            sendResult.error ?? 'Mission bridge not connected'
          );
          safeClientSend(
            JSON.stringify({
              ...failureAck,
              commandId: parsed.commandId,
              payload: withMissionCommandId(failureAck.payload, parsed.commandId),
            })
          );
          return;
        }

        try {
          if (missionRegistry?.recordCommandIntent) {
            void missionRegistry
              .recordCommandIntent(
                robotId,
                parsed.event,
                withMissionCommandId(parsed.payload, parsed.commandId)
              )
              .catch((error: unknown) => {
                fastify.log.warn({ robotId, error }, 'Failed to persist mission command intent');
              });
          }
        } catch (err) {
          fastify.log.error({ robotId, err }, 'Failed to persist mission command intent');
        }
        return;
      }

      safeClientSend(makeError(undefined, undefined, 'Unsupported mapping websocket message'));
    });

    clientSocket.on('close', () => {
      fastify.log.info({ robotId }, 'Dashboard client disconnected from mission websocket');
      closeClient();
    });

    clientSocket.on('error', err => {
      websocketMetrics.connectionErrors.add(1, {
        'robot.id': robotId,
        'websocket.type': 'unified-mapping',
        'error.reason': 'client_socket_error',
      });
      fastify.log.error({ robotId, err }, 'Dashboard WebSocket error');
      closeClient();
    });
  };

  fastify.get('/ws/robots/:robotId/mapping', { websocket: true }, unifiedMappingHandler);
  fastify.get('/ws/robots/:robotId/mapping/:label', { websocket: true }, unifiedMappingHandler);

  const emergencyProxyHandler = async (connection, request) => {
    const { robotId } = request.params as { robotId: string };
    const emergencyRegistry = (fastify as any).emergencyRegistry;

    const clientSocket =
      (connection as any).socket ??
      (connection as any).conn ??
      (connection as any).ws ??
      (connection as any).webSocket ??
      (typeof connection.send === 'function' ? (connection as any) : undefined);

    if (!clientSocket) {
      fastify.log.error({ robotId }, 'Emergency proxy WebSocket upgrade failed: no client socket');
      return;
    }

    if (!emergencyRegistry) {
      clientSocket.send(makeError(undefined, undefined, 'Emergency registry unavailable'));
      clientSocket.close();
      return;
    }

    let closed = false;

    const safeClientSend = (message: string) => {
      if (clientSocket.readyState !== WebSocket.OPEN) return;
      try {
        clientSocket.send(message);
      } catch (err) {
        fastify.log.error({ robotId, err }, 'Failed to send emergency proxy message to dashboard');
      }
    };

    const stringifyMessage = (data: unknown) => {
      if (typeof data === 'string') return data;
      if (Buffer.isBuffer(data)) return data.toString('utf8');
      return String(data ?? '');
    };

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
      const payloadText = stringifyMessage(raw);
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

      const eventName = parsed?.event ?? parsed?.type;
      if (eventName !== 'SOFTWARE_EMERGENCY') {
        safeClientSend(
          makeError(
            undefined,
            typeof parsed?.requestId === 'string' ? parsed.requestId : undefined,
            'Unsupported emergency websocket message'
          )
        );
        return;
      }

      const desiredStatus = parsed?.payload?.status;
      if (typeof desiredStatus !== 'boolean') {
        safeClientSend(
          makeError(
            undefined,
            typeof parsed?.requestId === 'string' ? parsed.requestId : undefined,
            'SOFTWARE_EMERGENCY payload.status must be boolean'
          )
        );
        return;
      }

      const sendResult = emergencyRegistry.sendSoftwareEmergency(robotId, desiredStatus);
      if (!sendResult.ok) {
        safeClientSend(
          makeError(
            undefined,
            typeof parsed?.requestId === 'string' ? parsed.requestId : undefined,
            sendResult.error ?? 'Emergency bridge not connected'
          )
        );
      }
    });

    clientSocket.on('close', () => {
      closeClient();
    });

    clientSocket.on('error', err => {
      websocketMetrics.connectionErrors.add(1, {
        'robot.id': robotId,
        'websocket.type': 'emergency-proxy',
        'error.reason': 'client_socket_error',
      });
      fastify.log.error({ robotId, err }, 'Emergency proxy dashboard WebSocket error');
      closeClient();
    });
  };

  fastify.get('/ws/robots/:robotId/emergency', { websocket: true }, emergencyProxyHandler);
  fastify.get('/ws/robots/:robotId/emergency/:label', { websocket: true }, emergencyProxyHandler);

  fastify.addHook('onClose', async () => {
    registry.stop();
  });
};

export default fp(rosGateway, {
  name: 'ros-gateway',
});
