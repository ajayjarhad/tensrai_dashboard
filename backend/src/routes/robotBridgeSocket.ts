import { trace } from '@opentelemetry/api';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import WebSocket from 'ws';
import { websocketMetrics } from '../metrics/index.js';
import type { RosRegistry } from '../services/rosRegistry.js';
import type { RosRobotManager } from '../services/rosRobotManager.js';
import {
  clientSocketOf,
  closeIfBacklogged,
  closeWhenAccessEnds,
  makeError,
} from './gatewaySocket.js';

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

type CommandMessage = Extract<IncomingMessage, { type: 'command' }>;
type CommandLogLevel = 'info' | 'warn';

type ForwardableChannelEvent = {
  channel: string;
  data: unknown;
  __serializedMessage?: string;
};

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
const ROS_TELEOP_STALE_WARN_MS = (() => {
  const raw = Number(process.env['ROS_TELEOP_STALE_WARN_MS'] ?? 1000);
  if (!Number.isFinite(raw) || raw <= 0) return Number.POSITIVE_INFINITY;
  return Math.floor(raw);
})();

const commandAgeMs = (sentAtMs: number | undefined) =>
  typeof sentAtMs === 'number' ? Date.now() - sentAtMs : null;

const commandLogLevel = (channel: string, ageMs: number | null): CommandLogLevel =>
  channel === 'teleop' && typeof ageMs === 'number' && ageMs >= ROS_TELEOP_STALE_WARN_MS
    ? 'warn'
    : 'info';

const staleCommandFields = (level: CommandLogLevel) =>
  level === 'warn' ? { reason: 'teleop_command_age_high' } : {};

export const createRobotBridgeHandler = (fastify: FastifyInstance, registry: RosRegistry) => {
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

  return (connection: any, request: FastifyRequest) => {
    const { robotId } = request.params as { robotId: string };
    const tracer = trace.getTracer('ros-gateway');
    const span = tracer.startSpan('websocket.robot.connection', {
      attributes: {
        'robot.id': robotId,
        'websocket.type': 'ros-bridge',
      },
    });
    const spanStartedAt = Date.now();

    // Access was checked at the upgrade, so the robot exists. No manager only means it has no
    // approved address right now: the socket stays open and attaches when it gets one.
    if (!registry.getManager(robotId)) {
      websocketMetrics.connectionErrors.add(1, {
        'robot.id': robotId,
        'websocket.type': 'ros-bridge',
        'error.reason': 'robot_not_found',
      });
    }

    const socket = clientSocketOf(connection);

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

    closeWhenAccessEnds(fastify, socket, request, robotId);

    const forward = (event: ForwardableChannelEvent) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (closeIfBacklogged(socket, fastify.log, { robotId, channel: event.channel })) return;
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

    let attachedManager: RosRobotManager | undefined;
    const attachManager = (nextManager: RosRobotManager | undefined) => {
      if (attachedManager === nextManager) return;
      attachedManager?.off('channel-data', forward);
      attachedManager = nextManager;
      if (!attachedManager) return;
      attachedManager.on('channel-data', forward);

      for (const event of attachedManager.getLatestChannelEvents()) {
        forward({
          channel: event.channel,
          data: event.data,
        });
      }
    };

    attachManager(registry.getManager(robotId));
    const stopFollowingManager = registry.onManagerChange(robotId, attachManager);

    const handleCommand = (command: CommandMessage) => {
      const commandId = command.commandId ?? null;
      const ageMs = commandAgeMs(command.sentAtMs);
      const level = commandLogLevel(command.channel, ageMs);
      logRosCommand(level, 'received', {
        robotId,
        channel: command.channel,
        commandId,
        sentAtMs: command.sentAtMs ?? null,
        ageMs,
        ...staleCommandFields(level),
        managerAttached: Boolean(attachedManager),
      });
      const currentManager = registry.getManager(robotId);
      if (!currentManager) {
        logRosCommand('warn', 'rejected', {
          robotId,
          channel: command.channel,
          commandId,
          reason: 'robot_not_found',
        });
        socket.send(makeError(command.channel, command.commandId, `Unknown robot: ${robotId}`));
        return;
      }
      const result = currentManager.handleCommand(command.channel, command.data);
      if (!result.ok) {
        const error = result.error ?? 'Command failed';
        logRosCommand('warn', 'rejected', {
          robotId,
          channel: command.channel,
          commandId,
          error,
          result,
        });
        socket.send(makeError(command.channel, command.commandId, error));
        return;
      }
      logRosCommand(level, 'published', {
        robotId,
        channel: command.channel,
        commandId,
        ...staleCommandFields(level),
        result,
      });
    };

    socket.on('message', async (buffer: Buffer) => {
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

      websocketMetrics.messagesReceived.add(1, {
        'robot.id': robotId,
        'websocket.type': 'ros-bridge',
        'message.type': parsed.type,
        'message.channel': parsed.channel || 'unknown',
      });

      if (parsed.type === 'command') {
        handleCommand(parsed);
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
      stopFollowingManager();
      attachedManager?.off('channel-data', forward);

      span.setAttributes({
        'websocket.connection.established': true,
        'websocket.connection.duration_ms': Date.now() - spanStartedAt,
      });
      span.end();
    });

    socket.on('error', (error: Error) => {
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
};
