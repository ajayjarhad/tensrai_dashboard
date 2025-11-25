// @ts-nocheck
import fp from 'fastify-plugin';
import websocket from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { RosRegistry } from '../services/rosRegistry.js';

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

const rosGateway = async (fastify: FastifyInstance) => {
  const registry = new RosRegistry(fastify.prisma, fastify.log);
  fastify.decorate('rosRegistry', registry);

  registry.reloadFromDb().catch(error => {
    fastify.log.error({ error }, 'Failed to load ROS registry from DB');
  });

  await fastify.register(websocket);

  fastify.get('/ws/robots/:robotId', { websocket: true }, (connection, request) => {
    const { robotId } = request.params as { robotId: string };
    const manager = registry.getManager(robotId);

    if (!manager) {
      connection.socket?.send?.(makeError(undefined, undefined, `Unknown robot: ${robotId}`));
      connection.socket?.close?.();
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
        socket.send(makeError(undefined, undefined, 'Invalid JSON message'));
        return;
      }

      if (parsed.type === 'command') {
        const result = manager.handleCommand(parsed.channel, parsed.data);
        if (!result.ok) {
          socket.send(makeError(parsed.channel, undefined, result.error ?? 'Command failed'));
        }
        return;
      }

      // Asset handling intentionally disabled for now (serve assets later via WS/HTTP)
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
    });
  });

  fastify.get('/health/ros', async () => {
    return {
      robots: registry.getStatuses(),
    };
  });

  fastify.addHook('onClose', async () => {
    registry.stop();
  });
};

export default fp(rosGateway, {
  name: 'ros-gateway',
});
