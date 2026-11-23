import { type Span, trace } from '@opentelemetry/api';
import type { Prisma, Robot } from '@prisma/client';
import { PERMISSIONS } from '@tensrai/shared';
import { z } from 'zod';
import { databaseMetrics, robotFleetMetrics } from '../metrics/index.js';
import {
  requireActiveSession,
  requireAdmin,
  requireOwnedRobot,
  requirePermission,
} from '../middleware/auth.js';
import { getMapSyncStatus, isMapSyncActive } from '../services/mapSyncStatus.js';
import { getMissionState } from '../services/missionStatus.js';
import type { ScopedPrisma } from '../services/orgScope.js';
import {
  isAddressApproved,
  maxRobotsPerOrg,
  parseRobotAddress,
  reloadRobotConnections,
  requestRobotAddress,
} from '../services/robotAddress.js';
import { robotJob } from '../services/robotMapJobs.js';
import { RosChannelSchema } from '../services/rosRobotManager.js';
import { fetchMapViaMappingBridge } from '../services/saveMapFromMapping.js';
import type { AppFastifyInstance, AppFastifyRequest, IdParams, SessionUser } from '../types/app.js';
import { errorCode } from '../utils/errorCode.js';

const RobotModeSchema = z.enum([
  'MISSION',
  'DOCKING',
  'CHARGING',
  'SW_EMERGENCY',
  'HW_EMERGENCY',
  'TELEOP',
  'AUTONOMOUS',
  'HRI',
  'UNKNOWN',
]);

const RobotNameSchema = z.string().trim().min(1).max(100);
const BridgePortSchema = z.number().int().min(1).max(65535).optional();

const SharedRobotFields = {
  status: RobotModeSchema.optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  theta: z.number().optional(),
  ipAddress: z.string().optional(),
  bridgePort: BridgePortSchema,
  mappingBridgePort: BridgePortSchema,
  missionBridgePort: BridgePortSchema,
  emergencyBridgePort: BridgePortSchema,
  channels: z.array(RosChannelSchema).optional(),
};

const CreateRobotSchema = z.object({
  ...SharedRobotFields,
  name: RobotNameSchema,
  mapId: z.string().optional(),
});

const UpdateRobotSchema = z.object({
  ...SharedRobotFields,
  name: RobotNameSchema.optional(),
  battery: z.number().min(0).max(100).optional(),
  // Map assignment is managed via POST /robots/:id/active-map and map-sync, not PATCH.
});

const ActiveMapSchema = z.object({
  mapId: z.string().min(1),
});

// Only reached behind requireActiveSession and requireAdmin, which establish the user and org.
const requestAddressFor = async (
  server: AppFastifyInstance,
  request: AppFastifyRequest,
  ip: string
) => {
  const user = (await request.getCurrentUser()) as SessionUser;
  return requestRobotAddress(server.prisma, {
    orgId: request.orgId as string,
    ip,
    requestedById: user.id,
    isStaff: user.role === 'STAFF',
  });
};

const robotMapInclude = {
  robotMaps: {
    include: { map: { select: { id: true, name: true } } },
  },
};

// Collapse a robot's RobotMap rows into a flat `maps` array and expose the active
// map id via the legacy `mapId` field for backward compatibility.
type RobotMapRow = {
  mapId: string;
  isActive: boolean;
  isPinned: boolean;
  syncedAt: Date;
  map?: { name: string } | null;
};

const shapeRobotWithMaps = <R extends { robotMaps?: RobotMapRow[]; mapId?: string | null }>(
  robot: R
) => {
  const maps = (robot.robotMaps ?? []).map(rm => ({
    id: rm.mapId,
    name: rm.map?.name ?? null,
    isActive: rm.isActive,
    isPinned: rm.isPinned,
    syncedAt: rm.syncedAt,
  }));
  const active = maps.find(m => m.isActive);
  const { robotMaps: _robotMaps, ...rest } = robot;
  return { ...rest, maps, mapId: active?.id ?? robot.mapId ?? null };
};

// Stores the parsed form of the address in place; returns the rejection when it doesn't parse.
const applyParsedAddress = (data: { ipAddress?: string | undefined }) => {
  if (!data.ipAddress) return undefined;
  const parsed = parseRobotAddress(data.ipAddress);
  if ('error' in parsed) return parsed;
  data.ipAddress = parsed.ip;
  return undefined;
};

const isMissingMap = async (prisma: ScopedPrisma, mapId: string | undefined) => {
  if (!mapId) return false;
  return !(await prisma.map.findUnique({ where: { id: mapId }, select: { id: true } }));
};

const activateInitialMap = async (
  prisma: ScopedPrisma,
  robotId: string,
  mapId: string | undefined
) => {
  if (!mapId) return;
  await prisma.robotMap.upsert({
    where: { robotId_mapId: { robotId, mapId } },
    update: { isActive: true },
    // The scoped client adds orgId, which Prisma's input type requires.
    create: {
      robotId,
      mapId,
      isActive: true,
      isPinned: false,
    } as Prisma.RobotMapUncheckedCreateInput,
  });
};

const recordStatusChange = (
  span: Span,
  robotId: string,
  previous: Pick<Robot, 'status'> | null,
  robot: Robot
) => {
  if (!previous || previous.status === robot.status) return;
  robotFleetMetrics.statusChanges.add(1, {
    'robot.id': robotId,
    'robot.status.from': previous.status,
    'robot.status.to': robot.status,
  });

  span.setAttributes({
    'robot.status.from': previous.status,
    'robot.status.to': robot.status,
    'robot.status.changed': true,
  });
};

const updateFailureReason = (code: unknown) => (code === 'P2025' ? 'not_found' : 'database_error');

const asException = (error: unknown) => (error instanceof Error ? error : String(error));

const respondWithSavedRobot = async (
  server: AppFastifyInstance,
  request: AppFastifyRequest,
  robot: Robot
) => {
  const addressStatus = robot.ipAddress
    ? await requestAddressFor(server, request, robot.ipAddress)
    : null;
  reloadRobotConnections(server);
  fetchMapViaMappingBridge(server, robot).catch(() => {});
  return { success: true, data: { ...robot, addressStatus } };
};

const robotRoutes = async (server: AppFastifyInstance) => {
  server.addHook('onRequest', requireActiveSession);
  const ownedRobot = requireOwnedRobot('id');
  server.addHook('onRequest', async (request, reply) =>
    (request.params as { id?: string } | undefined)?.id ? ownedRobot(request, reply) : undefined
  );

  // List all robots
  server.get('/robots', async request => {
    const tracer = trace.getTracer('robot-routes');
    const span = tracer.startSpan('robots.list');

    const startTime = Date.now();
    try {
      const prisma = request.db;
      const robots = await prisma.robot.findMany({
        orderBy: { name: 'asc' },
        include: robotMapInclude,
      });

      // Record query duration
      databaseMetrics.queryDuration.record(Date.now() - startTime, {
        'db.operation': 'findMany',
        'db.collection': 'robots',
      });

      databaseMetrics.operationCount.add(1, {
        'db.operation': 'findMany',
        'db.collection': 'robots',
      });

      span.setAttributes({
        'robots.count': robots.length,
        'db.query.duration_ms': Date.now() - startTime,
      });
      span.end();

      const withMission = robots.map(robot => ({
        ...shapeRobotWithMaps(robot),
        mission: getMissionState(robot.id),
      }));

      return { success: true, data: withMission };
    } catch (error) {
      databaseMetrics.queryDuration.record(Date.now() - startTime, {
        'db.operation': 'findMany',
        'db.collection': 'robots',
        'db.error': 'true',
      });

      span.recordException(error as Error);
      span.end();
      throw error;
    }
  });

  // The organization's robot addresses and whether each is approved. Separate from GET /robots,
  // which is polled and shouldn't pay for this; only the admin screen needs it.
  server.get('/robots/addresses', async request => {
    const addresses = await request.db.robotAddress.findMany({
      select: { ip: true, status: true },
    });
    return { success: true, data: addresses };
  });

  // Get single robot
  server.get<IdParams>('/robots/:id', async (request, reply) => {
    const { id } = request.params;
    const prisma = request.db;
    const robot = await prisma.robot.findUnique({
      where: { id },
      include: robotMapInclude,
    });

    if (!robot) {
      return reply.status(404).send({ success: false, error: 'Robot not found' });
    }

    return {
      success: true,
      data: { ...shapeRobotWithMaps(robot), mission: getMissionState(robot.id) },
    };
  });

  // List a robot's maps (the RobotMap assignments)
  server.get<IdParams>('/robots/:id/maps', async (request, reply) => {
    const { id } = request.params;
    const prisma = request.db;
    const robot = await prisma.robot.findUnique({
      where: { id },
      include: robotMapInclude,
    });

    if (!robot) {
      return reply.status(404).send({ success: false, error: 'Robot not found' });
    }

    return { success: true, data: shapeRobotWithMaps(robot).maps };
  });

  // Manually pin a robot's active map (suppresses auto-follow until cleared)
  server.post<IdParams & { Body: z.infer<typeof ActiveMapSchema> }>(
    '/robots/:id/active-map',
    async (request, reply) => {
      const { id } = request.params;
      const result = ActiveMapSchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({ success: false, error: result.error });
      }
      const { mapId } = result.data;
      const prisma = request.db;

      const assignment = await prisma.robotMap.findUnique({
        where: { robotId_mapId: { robotId: id, mapId } },
        select: { robotId: true },
      });
      if (!assignment) {
        return reply
          .status(404)
          .send({ success: false, error: 'Map is not assigned to this robot' });
      }

      let activated = true;
      try {
        await prisma.$transaction([
          prisma.robotMap.updateMany({
            where: { robotId: id },
            data: { isActive: false, isPinned: false },
          }),
          prisma.robotMap.update({
            where: { robotId_mapId: { robotId: id, mapId } },
            data: { isActive: true, isPinned: true },
          }),
          prisma.robot.update({ where: { id }, data: { mapId } }),
        ]);
      } catch (error) {
        // The robot or its assignment was deleted after the check above; the refetch says which.
        if (errorCode(error) !== 'P2025') throw error;
        activated = false;
      }

      const robot = await prisma.robot.findUnique({ where: { id }, include: robotMapInclude });
      if (!robot) {
        return reply.status(404).send({ success: false, error: 'Robot not found' });
      }
      if (!activated) {
        return reply
          .status(404)
          .send({ success: false, error: 'Map is not assigned to this robot' });
      }
      return { success: true, data: shapeRobotWithMaps(robot).maps };
    }
  );

  // Clear the manual pin and re-enable auto-follow
  server.post<IdParams>('/robots/:id/active-map/auto', async (request, reply) => {
    const { id } = request.params;
    const prisma = request.db;

    const robot = await prisma.robot.findUnique({ where: { id }, select: { id: true } });
    if (!robot) {
      return reply.status(404).send({ success: false, error: 'Robot not found' });
    }

    await prisma.robotMap.updateMany({ where: { robotId: id }, data: { isPinned: false } });

    const updated = await prisma.robot.findUnique({ where: { id }, include: robotMapInclude });
    if (!updated) {
      return reply.status(404).send({ success: false, error: 'Robot not found' });
    }
    return { success: true, data: shapeRobotWithMaps(updated).maps };
  });

  server.get<IdParams>('/robots/:id/map-sync', async request => {
    const { id } = request.params;
    return { success: true, data: getMapSyncStatus(id) };
  });

  server.post<IdParams>(
    '/robots/:id/map-sync',
    { preHandler: requirePermission(PERMISSIONS.MAPS_SYNC) },
    async (request, reply) => {
      const { id } = request.params;
      if (robotJob(id)) {
        return reply.status(409).send({
          success: false,
          code: 'ROBOT_BUSY',
          error: 'The robot is busy with another map operation. Try again shortly.',
        });
      }
      const prisma = request.db;
      const robot = await prisma.robot.findUnique({
        where: { id },
        select: {
          id: true,
          orgId: true,
          name: true,
          ipAddress: true,
          mappingBridgePort: true,
        },
      });

      if (!robot) {
        return reply.status(404).send({ success: false, error: 'Robot not found' });
      }

      if (!robot.ipAddress || !robot.mappingBridgePort) {
        return reply
          .status(400)
          .send({ success: false, error: 'Robot mapping bridge is not configured' });
      }

      if (!(await isAddressApproved(server.prisma, robot))) {
        return reply
          .status(409)
          .send({ success: false, error: 'Robot address is waiting for approval' });
      }

      const current = getMapSyncStatus(id);
      if (isMapSyncActive(current)) {
        return {
          success: true,
          data: current,
          message: 'Map sync already in progress',
        };
      }

      const status = await fetchMapViaMappingBridge(server, robot);
      return { success: true, data: status ?? getMapSyncStatus(id) };
    }
  );

  // Create robot (Backend/Testing only)
  server.post<{ Body: z.infer<typeof CreateRobotSchema> }>(
    '/robots',
    { onRequest: requireAdmin },
    async (request, reply) => {
      const result = CreateRobotSchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({ success: false, error: result.error });
      }

      const { name, mapId, channels, ...data } = result.data;
      const prisma = request.db;

      const invalidAddress = applyParsedAddress(data);
      if (invalidAddress) {
        return reply.status(400).send({ success: false, error: invalidAddress.error });
      }

      if ((await prisma.robot.count()) >= maxRobotsPerOrg()) {
        return reply.status(409).send({
          success: false,
          error: 'This organization has reached its robot limit',
          code: 'ROBOT_LIMIT_REACHED',
        });
      }

      try {
        if (await isMissingMap(prisma, mapId)) {
          return reply.status(404).send({ success: false, error: 'Map not found' });
        }

        const robot = await prisma.robot.create({
          data: {
            name,
            ...data,
            status: data.status || 'UNKNOWN',
            channels: channels ?? undefined,
            mapId,
            // The org-scoped client adds orgId, and zod leaves unset optional fields as undefined,
            // which Prisma skips.
          } as unknown as Prisma.RobotUncheckedCreateInput,
        });
        await activateInitialMap(prisma, robot.id, mapId);
        return await respondWithSavedRobot(server, request, robot);
      } catch (error) {
        if (errorCode(error) === 'P2002') {
          return reply
            .status(409)
            .send({ success: false, error: 'Robot with this name already exists' });
        }
        throw error;
      }
    }
  );

  // Update robot (Heartbeat/Status)
  server.patch<IdParams & { Body: z.infer<typeof UpdateRobotSchema> }>(
    '/robots/:id',
    { onRequest: requireAdmin },
    async (request, reply) => {
      const { id } = request.params;
      const result = UpdateRobotSchema.safeParse(request.body);
      const tracer = trace.getTracer('robot-routes');
      const span = tracer.startSpan('robots.update', {
        attributes: {
          'robot.id': id,
        },
      });

      if (!result.success) {
        span.setAttributes({
          'robot.update.success': false,
          'robot.update.reason': 'validation_error',
        });
        span.end();
        return reply.status(400).send({ success: false, error: result.error });
      }

      const invalidAddress = applyParsedAddress(result.data);
      if (invalidAddress) {
        span.setAttributes({
          'robot.update.success': false,
          'robot.update.reason': 'invalid_address',
        });
        span.end();
        return reply.status(400).send({ success: false, error: invalidAddress.error });
      }

      const prisma = request.db;
      const startTime = Date.now();

      try {
        // Get current robot state before update
        const currentRobot = await prisma.robot.findUnique({
          where: { id },
          select: { status: true, battery: true },
        });

        const { channels, ...rest } = result.data;
        const robot = await prisma.robot.update({
          where: { id },
          data: {
            ...rest,
            channels: channels ?? undefined,
            lastSeen: new Date(),
            // zod leaves unset optional fields as undefined, which Prisma skips.
          } as Prisma.RobotUncheckedUpdateInput,
        });

        recordStatusChange(span, id, currentRobot, robot);

        // Record database metrics
        databaseMetrics.queryDuration.record(Date.now() - startTime, {
          'db.operation': 'update',
          'db.collection': 'robots',
        });

        databaseMetrics.operationCount.add(1, {
          'db.operation': 'update',
          'db.collection': 'robots',
        });

        span.setAttributes({
          'robot.update.success': true,
          'robot.status': robot.status,
          'robot.battery': robot.battery ?? undefined,
          'db.query.duration_ms': Date.now() - startTime,
        });
        span.end();

        return await respondWithSavedRobot(server, request, robot);
      } catch (error) {
        const code = errorCode(error);
        databaseMetrics.queryDuration.record(Date.now() - startTime, {
          'db.operation': 'update',
          'db.collection': 'robots',
          'db.error': 'true',
        });

        span.setAttributes({
          'robot.update.success': false,
          'robot.update.reason': updateFailureReason(code),
        });

        if (code === 'P2025') {
          span.end();
          return reply.status(404).send({ success: false, error: 'Robot not found' });
        }

        if (code === 'P2002') {
          span.end();
          return reply
            .status(409)
            .send({ success: false, error: 'Robot with this name already exists' });
        }

        span.recordException(asException(error));
        span.end();
        throw error;
      }
    }
  );

  // Delete robot
  server.delete<IdParams>('/robots/:id', { onRequest: requireAdmin }, async (request, reply) => {
    const { id } = request.params;
    const prisma = request.db;
    try {
      await prisma.robot.delete({
        where: { id },
      });
      reloadRobotConnections(server);
      return { success: true, message: 'Robot deleted successfully' };
    } catch (error) {
      if (errorCode(error) === 'P2025') {
        return reply.status(404).send({ success: false, error: 'Robot not found' });
      }
      throw error;
    }
  });
};

export default robotRoutes;
