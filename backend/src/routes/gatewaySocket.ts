import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { stillHasRobotAccess } from '../middleware/auth.js';

export const makeError = (
  channel: string | undefined,
  requestId: string | undefined,
  message: string
) =>
  JSON.stringify({
    type: 'error',
    channel,
    requestId,
    message,
  });

// A dashboard tab that stops reading lets unsent frames pile up in our heap
// (this is what OOM-killed the backend). Bun's ws shim only starts counting
// bufferedAmount once its 16 MiB native backlog is full, and the counter never
// drains back to zero afterwards, so any sizeable value means the client fell
// hopelessly behind at some point: close it and let it reconnect (clients
// auto-reconnect and get a fresh snapshot on attach).
const HARD_CLOSE_BYTES = 4 * 1024 * 1024;

export const closeIfBacklogged = (socket: any, log: FastifyInstance['log'], fields: object) => {
  const buffered = typeof socket.bufferedAmount === 'number' ? socket.bufferedAmount : 0;
  if (buffered <= HARD_CLOSE_BYTES) return false;
  const close = socket.terminate ?? socket.close;
  if (typeof close !== 'function') return false;
  log.warn({ ...fields, buffered }, 'Closing slow dashboard websocket client');
  try {
    close.call(socket);
  } catch {}
  return true;
};

const SOCKET_ACCESS_RECHECK_MS = 30_000;

// Access is decided at the upgrade, but these sockets stay open for hours: a disabled user, a
// revoked session or a robot moved to another organization must not keep driving a robot.
export const closeWhenAccessEnds = (fastify: any, socket: any, request: any, robotId: string) => {
  const timer = setInterval(async () => {
    try {
      if (await stillHasRobotAccess(request, robotId)) return;
    } catch (err) {
      // A database outage shouldn't cut an operator off from a robot they may need to stop.
      fastify.log.warn({ robotId, err }, 'Could not re-check socket access');
      return;
    }
    clearInterval(timer);
    fastify.log.info({ robotId }, 'Closing dashboard websocket: access ended');
    socket.close(4401, 'Access ended');
  }, fastify.socketAccessRecheckMs ?? SOCKET_ACCESS_RECHECK_MS);
  timer.unref?.();
  socket.on('close', () => clearInterval(timer));
};

// Commands that change what a robot does get a record of who sent them. Teleop is left out: it's a
// stream of several messages a second, not a decision.
export const auditRobotCommand = async (
  fastify: any,
  request: any,
  action: string,
  metadata: object
) => {
  const user = await request.getCurrentUser?.();
  if (!user) return;
  await fastify.audit?.({
    orgId: request.orgId,
    userId: user.id,
    role: user.role,
    action,
    metadata,
  });
};

// @fastify/websocket normally puts the WS on connection.socket (Node),
// but Bun exposes it as conn/ws. Keep fallbacks so future WS routes work across runtimes.
export const clientSocketOf = (connection: any) =>
  connection.socket ??
  connection.conn ??
  connection.ws ??
  connection.webSocket ??
  (typeof connection.send === 'function' ? connection : undefined);

export const clientFrameText = (data: unknown) => {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  return String(data ?? '');
};

export const createClientSender =
  (
    log: FastifyInstance['log'],
    socket: any,
    robotId: string,
    socketName: string,
    failureMessage: string
  ) =>
  (message: string) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (closeIfBacklogged(socket, log, { robotId, socket: socketName })) return;
    try {
      socket.send(message);
    } catch (err) {
      log.error({ robotId, err }, failureMessage);
    }
  };
