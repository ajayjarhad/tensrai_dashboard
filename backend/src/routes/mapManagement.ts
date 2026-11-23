import { PERMISSIONS } from '@tensrai/shared';
import { z } from 'zod';
import { requireActiveSession, requireOwnedRobot, requirePermission } from '../middleware/auth.js';
import { pgmOf } from '../services/mapImage.js';
import type { MapSyncHost } from '../services/mapRecords.js';
import {
  buildMapContent,
  decodeUploadedPgm,
  MapInputError,
  parseMapFeatures,
  parseMapYaml,
} from '../services/mapUpload.js';
import {
  assignMap,
  forgetFailedAssignment,
  type JobAudit,
  type JobContext,
  type JobRobot,
  pushMaps,
  RobotJobRefused,
  type RobotMapJobKind,
  resolveConflict,
  robotStateFor,
  startRobotJob,
  unassignMap,
} from '../services/robotMapJobs.js';
import { missionIdConflicts, missionIds, renumberIds } from '../services/robotMetadata.js';
import type { AppFastifyInstance, AppFastifyReply, AppFastifyRequest } from '../types/app.js';

// Maps and their robot copies change here; routes/maps.ts keeps the reads. Every map and robot id is
// looked up through the organization-scoped request.db, so another organization's ids are 404s.

const BODY_LIMIT = 8 * 1024 * 1024;
const MAX_MAPS_PER_ORG = Number(process.env['MAX_MAPS_PER_ORG'] ?? 200);

const MapName = z.string().trim().min(1).max(100);
const CreateMapBody = z.object({
  name: MapName,
  yaml: z.string().min(1),
  pgmGzipBase64: z.string().min(1),
  features: z.unknown().optional(),
});
const UpdateMapBody = z.object({
  baseRevision: z.string().min(1).optional(),
  name: MapName.optional(),
  yaml: z.string().min(1).optional(),
  features: z.unknown().optional(),
  pgmGzipBase64: z.string().min(1).optional(),
  renumberMissions: z.boolean().optional(),
});
const PushBody = z.object({ robotIds: z.array(z.string().min(1)).max(100).optional() }).optional();
const ResolveBody = z.object({ keep: z.enum(['dashboard', 'robot']) });

type MapParams = { Params: { id: string } };
type MapRobotParams = { Params: { id: string; robotId: string } };

const fail = (reply: AppFastifyReply, status: number, code: string, error: string) =>
  reply.status(status).send({ success: false, error, code });

const sendInputError = (reply: AppFastifyReply, error: unknown) => {
  if (error instanceof MapInputError) return fail(reply, error.status, error.code, error.message);
  throw error;
};

const ROBOT_FOR_JOBS = {
  id: true,
  orgId: true,
  name: true,
  ipAddress: true,
  mappingBridgePort: true,
} as const;

// Jobs outlive the request, so they audit through the server with who asked.
const auditFor = async (
  server: AppFastifyInstance,
  request: AppFastifyRequest
): Promise<JobAudit> => {
  const user = await request.getCurrentUser();
  return (action, metadata) =>
    server.audit({
      ...(request.orgId ? { orgId: request.orgId } : {}),
      userId: user?.id ?? 'unknown',
      role: user?.role ?? 'unknown',
      action,
      metadata,
    });
};

// The name the Maps page shows beside an edit.
const editorName = async (request: AppFastifyRequest) => {
  const user = await request.getCurrentUser();
  return user?.displayName || user?.username || null;
};

const nextFreeFilename = async (request: AppFastifyRequest) => {
  const maps = await request.db.map.findMany({ select: { filename: true } });
  const taken = new Set(maps.map(map => map.filename));
  for (let n = 1; ; n += 1) if (!taken.has(`map${n}.yaml`)) return `map${n}.yaml`;
};

const startJob = async (
  server: AppFastifyInstance,
  request: AppFastifyRequest,
  reply: AppFastifyReply,
  robotId: string,
  kind: RobotMapJobKind,
  mapIds: string[],
  work: (context: JobContext) => Promise<void>
) => {
  const robot = (await request.db.robot.findUnique({
    where: { id: robotId },
    select: ROBOT_FOR_JOBS,
  })) as JobRobot | null;
  if (!robot) return fail(reply, 404, 'ROBOT_NOT_FOUND', 'Robot not found');
  const host: MapSyncHost = { log: server.log, prisma: request.db };
  try {
    const job = await startRobotJob(
      host,
      robot,
      kind,
      mapIds,
      await auditFor(server, request),
      work
    );
    return reply.status(202).send({ success: true, data: job });
  } catch (error) {
    if (error instanceof RobotJobRefused)
      return fail(reply, error.status, error.code, error.message);
    throw error;
  }
};

type UpdateMapInput = z.infer<typeof UpdateMapBody>;
type StoredMap = {
  id: string;
  image: Uint8Array;
  metadata: unknown;
  features: unknown;
  revision: string | null;
};

const changesContent = (body: UpdateMapInput) =>
  body.yaml !== undefined ||
  body.features !== undefined ||
  body.pgmGzipBase64 !== undefined ||
  Boolean(body.renumberMissions);

const mapChanged = (reply: AppFastifyReply) =>
  fail(reply, 409, 'MAP_CHANGED', 'Someone else saved this map since you opened it.');

// The map as the edit leaves it; whatever the edit doesn't send stays as stored.
const editedContent = async (request: AppFastifyRequest, map: StoredMap, body: UpdateMapInput) => {
  const pgm = body.pgmGzipBase64 ? decodeUploadedPgm(body.pgmGzipBase64).pgm : pgmOf(map.image);
  const metadata = body.yaml ? parseMapYaml(body.yaml) : (map.metadata as Record<string, unknown>);
  let features = body.features === undefined ? map.features : body.features;
  if (body.renumberMissions) {
    // Unique across the organization, so the map can go to any robot.
    const others = await request.db.map.findMany({
      where: { id: { not: map.id } },
      select: { features: true },
    });
    features = renumberIds(
      features,
      others.flatMap(other => missionIds(other.features))
    );
  }
  return buildMapContent(pgm, metadata, parseMapFeatures(features));
};

// Compare-and-swap on the revision the editor opened. False when someone saved in between.
const saveEdit = async (
  request: AppFastifyRequest,
  mapId: string,
  baseRevision: string,
  content: Awaited<ReturnType<typeof buildMapContent>>,
  name: string | undefined
) => {
  // Robots linked before revisions hold the version being replaced: say so, so they show as
  // needing a sync rather than as a conflict.
  await request.db.robotMap.updateMany({
    where: { mapId, pushedRevision: { isSet: false } },
    data: { pushedRevision: baseRevision },
  });
  const saved = await request.db.map.updateMany({
    where: { id: mapId, revision: baseRevision },
    data: {
      ...content,
      ...(name ? { name } : {}),
      editedAt: new Date(),
      editedBy: await editorName(request),
    },
  });
  return saved.count > 0;
};

const commitEdit = async (
  server: AppFastifyInstance,
  request: AppFastifyRequest,
  reply: AppFastifyReply,
  map: StoredMap,
  baseRevision: string,
  content: Awaited<ReturnType<typeof buildMapContent>>,
  name: string | undefined
) => {
  if (content.revision === map.revision)
    return { success: true, data: { id: map.id, revision: map.revision } };
  const duplicate = await request.db.map.findFirst({
    where: { revision: content.revision, id: { not: map.id } },
    select: { name: true },
  });
  if (duplicate) {
    return fail(
      reply,
      409,
      'MAP_DUPLICATE',
      `This would make the map identical to “${duplicate.name}”.`
    );
  }
  if (!(await saveEdit(request, map.id, baseRevision, content, name))) return mapChanged(reply);
  await (await auditFor(server, request))('MAP_UPDATED', {
    mapId: map.id,
    revision: content.revision,
    previousRevision: map.revision,
  });
  return { success: true, data: { id: map.id, revision: content.revision } };
};

const startPushFor = async (
  server: AppFastifyInstance,
  request: AppFastifyRequest,
  robotId: string,
  mapId: string,
  audit: JobAudit
) => {
  const robot = (await request.db.robot.findUnique({
    where: { id: robotId },
    select: ROBOT_FOR_JOBS,
  })) as JobRobot | null;
  if (!robot) return { robotId, started: false, code: 'ROBOT_NOT_FOUND', error: 'Robot not found' };
  try {
    await startRobotJob(
      { log: server.log, prisma: request.db },
      robot,
      'push',
      [mapId],
      audit,
      pushMaps([mapId])
    );
    return { robotId, started: true };
  } catch (error) {
    if (!(error instanceof RobotJobRefused)) throw error;
    return { robotId, started: false, code: error.code, error: error.message };
  }
};

const mapManagementRoutes = async (server: AppFastifyInstance) => {
  server.addHook('onRequest', requireActiveSession);

  server.post(
    '/maps',
    {
      preHandler: requirePermission(PERMISSIONS.MAPS_EDIT),
      bodyLimit: BODY_LIMIT,
      config: { rateLimit: { max: 60, timeWindow: '1 hour' } },
    },
    async (request, reply) => {
      const body = CreateMapBody.safeParse(request.body);
      if (!body.success)
        return fail(reply, 400, 'INVALID_BODY', 'Name, YAML and image are required');
      if ((await request.db.map.count()) >= MAX_MAPS_PER_ORG) {
        return fail(reply, 409, 'MAP_LIMIT', `An organization can hold ${MAX_MAPS_PER_ORG} maps.`);
      }
      let content: Awaited<ReturnType<typeof buildMapContent>>;
      try {
        const { pgm } = decodeUploadedPgm(body.data.pgmGzipBase64);
        const metadata = parseMapYaml(body.data.yaml);
        content = await buildMapContent(pgm, metadata, parseMapFeatures(body.data.features));
      } catch (error) {
        return sendInputError(reply, error);
      }
      const duplicate = await request.db.map.findFirst({
        where: { revision: content.revision },
        select: { name: true },
      });
      if (duplicate) {
        return fail(reply, 409, 'MAP_DUPLICATE', `This map is identical to “${duplicate.name}”.`);
      }
      const map = await request.db.map.create({
        data: {
          orgId: request.orgId as string,
          name: body.data.name,
          filename: await nextFreeFilename(request),
          ...content,
          editedAt: new Date(),
          editedBy: await editorName(request),
        },
        select: { id: true, name: true, filename: true, revision: true },
      });
      await (await auditFor(server, request))('MAP_CREATED', {
        mapId: map.id,
        revision: map.revision,
      });
      return reply.status(201).send({ success: true, data: map });
    }
  );

  server.patch<MapParams>(
    '/maps/:id',
    { preHandler: requirePermission(PERMISSIONS.MAPS_EDIT), bodyLimit: BODY_LIMIT },
    async (request, reply) => {
      const body = UpdateMapBody.safeParse(request.body);
      if (!body.success) return fail(reply, 400, 'INVALID_BODY', 'Invalid map update');
      const { id } = request.params;
      const map = await request.db.map.findUnique({
        where: { id },
        select: { id: true, image: true, metadata: true, features: true, revision: true },
      });
      if (!map) return fail(reply, 404, 'MAP_NOT_FOUND', 'Map not found');

      const { baseRevision, name } = body.data;
      if (!changesContent(body.data)) {
        if (name) await request.db.map.update({ where: { id }, data: { name } });
        return { success: true, data: { id, name, revision: map.revision } };
      }
      if (!baseRevision) return fail(reply, 400, 'INVALID_BODY', 'baseRevision is required');
      if (baseRevision !== map.revision) return mapChanged(reply);

      try {
        const content = await editedContent(request, map, body.data);
        return await commitEdit(server, request, reply, map, baseRevision, content, name);
      } catch (error) {
        return sendInputError(reply, error);
      }
    }
  );

  server.delete<MapParams>(
    '/maps/:id',
    { preHandler: requirePermission(PERMISSIONS.MAPS_DELETE) },
    async (request, reply) => {
      const { id } = request.params;
      const map = await request.db.map.findUnique({
        where: { id },
        select: { id: true, revision: true },
      });
      if (!map) return fail(reply, 404, 'MAP_NOT_FOUND', 'Map not found');
      if ((await request.db.robotMap.count({ where: { mapId: id } })) > 0) {
        return fail(
          reply,
          409,
          'MAP_ASSIGNED',
          'Remove this map from every robot before deleting it.'
        );
      }
      await request.db.map.delete({ where: { id } });
      await (await auditFor(server, request))('MAP_DELETED', { mapId: id, revision: map.revision });
      return { success: true };
    }
  );

  server.put<MapRobotParams>(
    '/maps/:id/robots/:robotId',
    { preHandler: requirePermission(PERMISSIONS.MAPS_SYNC) },
    async (request, reply) => {
      const { id, robotId } = request.params;
      const map = await request.db.map.findUnique({
        where: { id },
        select: { id: true, features: true },
      });
      if (!map) return fail(reply, 404, 'MAP_NOT_FOUND', 'Map not found');
      const others = await request.db.robotMap.findMany({
        where: { robotId, mapId: { not: id } },
        select: { mapId: true },
      });
      const otherMaps = await request.db.map.findMany({
        where: { id: { in: others.map(other => other.mapId) } },
        select: { features: true },
      });
      const clashes = missionIdConflicts(
        map.features,
        otherMaps.map(other => other.features)
      );
      if (clashes.length > 0) {
        return fail(
          reply,
          409,
          'MISSION_ID_CONFLICT',
          `Mission ${clashes.join(', ')} already exists on this robot in another map. Renumber this map's missions first.`
        );
      }
      return startJob(server, request, reply, robotId, 'assign', [id], assignMap(id));
    }
  );

  server.delete<MapRobotParams>(
    '/maps/:id/robots/:robotId',
    { preHandler: requirePermission(PERMISSIONS.MAPS_SYNC) },
    async (request, reply) => {
      const { id, robotId } = request.params;
      const link = await request.db.robotMap.findFirst({
        where: { mapId: id, robotId },
        select: { isActive: true },
      });
      if (!link) {
        const map = await request.db.map.findFirst({ where: { id }, select: { id: true } });
        if (map && forgetFailedAssignment(robotId, id)) return { success: true };
        return fail(reply, 404, 'NOT_ASSIGNED', 'The robot does not hold this map');
      }
      if (link.isActive) {
        return fail(
          reply,
          409,
          'MAP_ACTIVE',
          "This is the robot's active map. Switch its map on the dashboard first."
        );
      }
      return startJob(server, request, reply, robotId, 'unassign', [id], unassignMap(id));
    }
  );

  server.post<MapParams>(
    '/maps/:id/push',
    { preHandler: requirePermission(PERMISSIONS.MAPS_SYNC) },
    async (request, reply) => {
      const body = PushBody.safeParse(request.body ?? undefined);
      if (!body.success) return fail(reply, 400, 'INVALID_BODY', 'Invalid robot list');
      const { id } = request.params;
      const map = await request.db.map.findUnique({ where: { id }, select: { id: true } });
      if (!map) return fail(reply, 404, 'MAP_NOT_FOUND', 'Map not found');
      const links = await request.db.robotMap.findMany({
        where: {
          mapId: id,
          ...(body.data?.robotIds ? { robotId: { in: body.data.robotIds } } : {}),
        },
        select: { robotId: true },
      });
      const audit = await auditFor(server, request);
      const results = [];
      for (const { robotId } of links) {
        results.push(await startPushFor(server, request, robotId, id, audit));
      }
      return reply.status(202).send({ success: true, data: results });
    }
  );

  server.post<{ Params: { id: string } }>(
    '/robots/:id/maps/push',
    { preHandler: [requireOwnedRobot('id'), requirePermission(PERMISSIONS.MAPS_SYNC)] },
    async (request, reply) => {
      const robotId = request.params.id;
      const links = await request.db.robotMap.findMany({
        where: { robotId },
        select: { robotId: true, mapId: true, pushedRevision: true, conflictRevision: true },
      });
      const maps = await request.db.map.findMany({
        where: { id: { in: links.map(link => link.mapId) } },
        select: { id: true, revision: true, editedAt: true },
      });
      const needed = links
        .filter(link => {
          const map = maps.find(candidate => candidate.id === link.mapId);
          return map && robotStateFor(link, map).state === 'needs_sync';
        })
        .map(link => link.mapId);
      if (needed.length === 0) return { success: true, data: null };
      return startJob(server, request, reply, robotId, 'push', needed, pushMaps(needed));
    }
  );

  server.post<MapRobotParams>(
    '/maps/:id/robots/:robotId/resolve',
    { preHandler: requirePermission(PERMISSIONS.MAPS_SYNC) },
    async (request, reply) => {
      const body = ResolveBody.safeParse(request.body);
      if (!body.success) return fail(reply, 400, 'INVALID_BODY', 'keep must be dashboard or robot');
      const { id, robotId } = request.params;
      const link = await request.db.robotMap.findFirst({
        where: { mapId: id, robotId },
        select: { conflictRevision: true },
      });
      if (!link) return fail(reply, 404, 'NOT_ASSIGNED', 'The robot does not hold this map');
      if (!link.conflictRevision)
        return fail(reply, 409, 'NO_CONFLICT', 'There is no conflict to resolve');
      return startJob(
        server,
        request,
        reply,
        robotId,
        'resolve',
        [id],
        resolveConflict(id, body.data.keep)
      );
    }
  );
};

export default mapManagementRoutes;
