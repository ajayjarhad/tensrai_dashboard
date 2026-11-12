import websocket from '@fastify/websocket';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { requireActiveSession, requireOwnedRobot } from '../middleware/auth.js';
import { RosRegistry } from '../services/rosRegistry.js';
import { createEmergencySocketHandler } from './emergencySocket.js';
import { createMissionSocketHandler } from './missionSocket.js';
import { createRobotBridgeHandler } from './robotBridgeSocket.js';

// CORS doesn't cover sockets and the session cookie goes with any same-site page, including another
// port on this host, so a page has to be this dashboard (or an allowed origin) to drive a robot.
const refuseForeignOrigin = async (request: FastifyRequest, reply: FastifyReply) => {
  const origin: string | undefined = request.headers.origin;
  if (!origin || (request.server as any).isAllowedOrigin?.(origin)) return;
  const host = request.headers['x-forwarded-host'] ?? request.headers.host;
  if (URL.canParse(origin) && new URL(origin).host === host) return;
  request.log.warn({ origin }, 'Refused a robot socket from another origin');
  return reply.status(403).send({ success: false, error: 'Origin not allowed' });
};

const rosGateway = async (fastify: FastifyInstance) => {
  const registry = new RosRegistry(fastify.prisma, fastify.log);
  fastify.decorate('rosRegistry', registry);

  registry.reloadFromDb().catch((error: unknown) => {
    fastify.log.error({ error }, 'Failed to load ROS registry from DB');
  });

  await fastify.register(websocket);

  // The upgrade runs through normal routing, so a rejected hook answers the handshake with
  // 401/403/404. The registries are keyed by robot id alone, so the robot must be the caller's.
  const authedSocket = {
    websocket: true as const,
    onRequest: [refuseForeignOrigin, requireActiveSession, requireOwnedRobot('robotId')],
  };

  const robotBridgeHandler = createRobotBridgeHandler(fastify, registry);
  fastify.get('/ws/robots/:robotId', authedSocket, robotBridgeHandler);
  fastify.get('/ws/robots/:robotId/telemetry/:label', authedSocket, robotBridgeHandler);

  fastify.get('/health/ros', { onRequest: requireActiveSession }, async request => {
    const robots = await request.db.robot.findMany({ select: { id: true } });
    const owned = new Set<string>(robots.map((robot: { id: string }) => robot.id));
    const missions: { robotId: string }[] = (fastify as any).missionRegistry?.getStatuses?.() ?? [];
    return {
      robots: registry.getStatuses().filter((status: { id: string }) => owned.has(status.id)),
      missions: missions.filter(status => owned.has(status.robotId)),
    };
  });

  const missionHandler = createMissionSocketHandler(fastify);
  fastify.get('/ws/robots/:robotId/mapping', authedSocket, missionHandler);
  fastify.get('/ws/robots/:robotId/mapping/:label', authedSocket, missionHandler);

  const emergencyHandler = createEmergencySocketHandler(fastify);
  fastify.get('/ws/robots/:robotId/emergency', authedSocket, emergencyHandler);
  fastify.get('/ws/robots/:robotId/emergency/:label', authedSocket, emergencyHandler);

  fastify.addHook('onClose', async () => {
    registry.stop();
  });
};

export default fp(rosGateway, {
  name: 'ros-gateway',
});
