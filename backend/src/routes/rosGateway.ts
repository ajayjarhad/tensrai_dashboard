// @ts-nocheck
import websocket from '@fastify/websocket';
import { trace } from '@opentelemetry/api';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import WebSocket from 'ws';
import { mapMetrics, websocketMetrics } from '../metrics/index.js';
import {
  buildMissionFailureAck,
  isMissionControlEvent,
  isMissionStatusEvent,
  updateMissionFromEvent,
} from '../services/missionStatus.js';
import { syncRobotStatusUpdate } from '../services/robotStatusSync.js';
import { RosRegistry } from '../services/rosRegistry.js';
import { upsertMapFromResponse } from '../services/saveMapFromMapping.js';

type IncomingMessage =
  | {
      type: 'command';
      channel: string;
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

const parseGatewayEvent = (payload: string): { event: string; payload?: unknown } | null => {
  try {
    const parsed = JSON.parse(payload);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.event !== 'string' || parsed.event.trim().length === 0) return null;
    return parsed as { event: string; payload?: unknown };
  } catch {
    return null;
  }
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

    const manager = registry.getManager(robotId);

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

    const forward = (event: { channel: string; data: unknown }) => {
      try {
        socket.send(makeEvent(event.channel, event.data));
      } catch (err) {
        fastify.log.error({ err }, 'Failed to forward ROS event');
      }
    };

    manager.on('channel-data', forward);

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
        const result = manager.handleCommand(parsed.channel, parsed.data);
        if (!result.ok) {
          socket.send(makeError(parsed.channel, undefined, result.error ?? 'Command failed'));
        }
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
      manager.off('channel-data', forward);

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
    };
  });

  const unifiedMappingHandler = async (connection, request) => {
    const { robotId } = request.params as { robotId: string };
    const robot = await (fastify.prisma as any).robot.findUnique({ where: { id: robotId } });

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

    if (!robot?.ipAddress) {
      clientSocket.send(makeError(undefined, undefined, 'Robot IP not configured'));
      clientSocket.close();
      return;
    }

    const mappingUrl = robot.mappingBridgePort
      ? `ws://${robot.ipAddress}:${robot.mappingBridgePort}`
      : null;
    const missionUrl = robot.missionBridgePort
      ? `ws://${robot.ipAddress}:${robot.missionBridgePort}`
      : null;

    if (!mappingUrl && !missionUrl) {
      clientSocket.send(makeError(undefined, undefined, 'No mapping or mission bridge configured'));
      clientSocket.close();
      return;
    }

    const mappingSocket = mappingUrl ? new WebSocket(mappingUrl) : null;
    const missionSocket = missionUrl ? new WebSocket(missionUrl) : null;

    let mappingAlive = Boolean(mappingSocket);
    let missionAlive = Boolean(missionSocket);
    let closed = false;

    const stringifyMessage = (data: unknown, isBinary?: boolean) => {
      if (!isBinary && typeof data === 'string') return data;
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

    const maybeCloseClient = () => {
      if (closed) return;
      if (mappingAlive || missionAlive) return;
      closed = true;
      try {
        clientSocket.close();
      } catch {}
    };

    const closeAll = () => {
      if (closed) return;
      closed = true;
      mappingAlive = false;
      missionAlive = false;
      try {
        mappingSocket?.close();
      } catch {}
      try {
        missionSocket?.close();
      } catch {}
      try {
        clientSocket.close();
      } catch {}
    };

    const handleMissionStatusEvent = async (payloadText: string) => {
      const parsed = parseGatewayEvent(payloadText);

      if (!parsed) {
        safeClientSend(payloadText);
        return;
      }

      if (parsed.event && isMissionStatusEvent(parsed.event)) {
        updateMissionFromEvent(robotId, parsed.event, parsed.payload);
      }

      if (parsed.event === 'ROBOT_STATUS_UPDATE') {
        const syncResult = await syncRobotStatusUpdate(
          {
            prisma: fastify.prisma as any,
            log: fastify.log,
            rememberNonEmergencyStatus: (
              fastify as any
            ).emergencyRegistry?.rememberNonEmergencyStatus?.bind(
              (fastify as any).emergencyRegistry
            ),
          },
          robotId,
          parsed.payload
        );
        if (!syncResult.ok) {
          fastify.log.warn(
            { robotId, reason: syncResult.reason, event: parsed.event },
            'Dropped ROBOT_STATUS_UPDATE during sync'
          );
        }
      }

      if (parsed.event && isMissionStatusEvent(parsed.event)) {
        safeClientSend(payloadText);
      }
    };

    if (mappingSocket) {
      mappingSocket.on('open', () => {
        fastify.log.info({ robotId, mappingUrl }, 'Connected to mapping bridge');
        try {
          mappingSocket.send(
            JSON.stringify({
              event: 'GET_MAP_DATA',
              payload: {},
            })
          );
        } catch (err) {
          fastify.log.error({ robotId, mappingUrl, err }, 'Failed to send GET_MAP_DATA');
        }
      });

      mappingSocket.on('message', async (data, isBinary) => {
        const payloadText = stringifyMessage(data, isBinary);
        websocketMetrics.messagesReceived.add(1, {
          'robot.id': robotId,
          'websocket.type': 'unified-mapping',
          'message.source': 'mapping_bridge',
        });

        try {
          const parsed = parseGatewayEvent(payloadText);

          if (parsed?.event === 'MAP_DATA_RESPONSE' && (parsed as any)?.payload?.files) {
            const tracer = trace.getTracer('ros-gateway');
            const span = tracer.startSpan('map.upload', {
              attributes: {
                'robot.id': robotId,
                'websocket.type': 'mapping-bridge',
              },
            });

            try {
              await upsertMapFromResponse(fastify, robotId, (parsed as any).payload.files);
              mapMetrics.uploadCount.add(1, { 'robot.id': robotId });
              span.setAttributes({ 'map.upload.success': true });
            } catch (error) {
              span.setAttributes({
                'map.upload.success': false,
                'map.upload.error': (error as Error).message,
              });
              span.recordException(error as Error);
            } finally {
              span.end();
            }
          }

          if (parsed?.event && isMissionStatusEvent(parsed.event)) {
            const missionBridgeConnected =
              Boolean(missionSocket) && missionSocket?.readyState === WebSocket.OPEN;
            if (missionBridgeConnected) {
              fastify.log.debug(
                { robotId, event: parsed.event },
                'Skipping mission status event from mapping bridge while mission bridge is connected'
              );
            } else {
              await handleMissionStatusEvent(payloadText);
            }
          }
        } catch (err) {
          fastify.log.warn({ robotId, err }, 'Failed to process mapping bridge payload');
        }
      });

      mappingSocket.on('close', () => {
        mappingAlive = false;
        maybeCloseClient();
      });

      mappingSocket.on('error', err => {
        mappingAlive = false;
        websocketMetrics.connectionErrors.add(1, {
          'robot.id': robotId,
          'websocket.type': 'unified-mapping',
          'error.reason': 'mapping_bridge_error',
        });
        fastify.log.error({ robotId, mappingUrl, err }, 'Mapping bridge error');
        safeClientSend(makeError(undefined, undefined, 'Mapping bridge error'));
        maybeCloseClient();
      });
    }

    if (missionSocket) {
      missionSocket.on('open', () => {
        fastify.log.info({ robotId, missionUrl }, 'Connected to mission bridge');
      });

      missionSocket.on('message', async (data, isBinary) => {
        const payloadText = stringifyMessage(data, isBinary);
        websocketMetrics.messagesReceived.add(1, {
          'robot.id': robotId,
          'websocket.type': 'unified-mapping',
          'message.source': 'mission_bridge',
        });
        await handleMissionStatusEvent(payloadText);
      });

      missionSocket.on('close', () => {
        missionAlive = false;
        maybeCloseClient();
      });

      missionSocket.on('error', err => {
        missionAlive = false;
        websocketMetrics.connectionErrors.add(1, {
          'robot.id': robotId,
          'websocket.type': 'unified-mapping',
          'error.reason': 'mission_bridge_error',
        });
        fastify.log.error({ robotId, missionUrl, err }, 'Mission bridge error');
        safeClientSend(makeError(undefined, undefined, 'Mission bridge error'));
        maybeCloseClient();
      });
    }

    clientSocket.on('message', (msg: Buffer | string) => {
      const payloadText = stringifyMessage(msg);
      websocketMetrics.messagesReceived.add(1, {
        'robot.id': robotId,
        'websocket.type': 'unified-mapping',
        'message.source': 'dashboard_client',
      });

      const parsed = parseGatewayEvent(payloadText);

      if (parsed?.event && isMissionControlEvent(parsed.event)) {
        if (!missionSocket || missionSocket.readyState !== WebSocket.OPEN) {
          const failureAck = buildMissionFailureAck(
            parsed.event,
            parsed.payload,
            'Mission bridge not connected'
          );
          safeClientSend(JSON.stringify(failureAck));
          if (failureAck?.event && isMissionStatusEvent(failureAck.event)) {
            updateMissionFromEvent(robotId, failureAck.event, failureAck.payload);
          }
          return;
        }

        try {
          missionSocket.send(payloadText);
        } catch (err) {
          fastify.log.error({ robotId, missionUrl, err }, 'Failed to forward mission command');
        }
        return;
      }

      if (mappingSocket && mappingSocket.readyState === WebSocket.OPEN) {
        try {
          mappingSocket.send(msg);
        } catch (err) {
          fastify.log.error({ robotId, mappingUrl, err }, 'Failed to forward mapping message');
        }
        return;
      }

      if (missionSocket && missionSocket.readyState === WebSocket.OPEN) {
        try {
          missionSocket.send(msg);
        } catch (err) {
          fastify.log.error(
            { robotId, missionUrl, err },
            'Failed to forward fallback mission message'
          );
        }
        return;
      }

      safeClientSend(makeError(undefined, undefined, 'No upstream bridge is currently connected'));
    });

    clientSocket.on('close', () => {
      closeAll();
    });

    clientSocket.on('error', err => {
      websocketMetrics.connectionErrors.add(1, {
        'robot.id': robotId,
        'websocket.type': 'unified-mapping',
        'error.reason': 'client_socket_error',
      });
      fastify.log.error({ robotId, err }, 'Dashboard WebSocket error');
      closeAll();
    });
  };

  fastify.get('/ws/robots/:robotId/mapping', { websocket: true }, unifiedMappingHandler);
  fastify.get('/ws/robots/:robotId/mapping/:label', { websocket: true }, unifiedMappingHandler);

  fastify.addHook('onClose', async () => {
    registry.stop();
  });
};

export default fp(rosGateway, {
  name: 'ros-gateway',
});
