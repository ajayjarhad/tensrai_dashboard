import { isRecord } from '@tensrai/shared';
import { requireActiveSession } from '../middleware/auth.js';
import { freeStem, robotCannotReceiveMaps, stemOf } from '../services/robotMapJobs.js';
import { missionIdConflicts, missionIds } from '../services/robotMetadata.js';
import type { AppFastifyInstance, AppFastifyReply } from '../types/app.js';

// Reads behind the Assign and Conflict dialogs: what assigning a map would do on each robot, and what
// a robot's conflicting copy holds. Open to any active member, like the other map reads.

type MapParams = { Params: { id: string } };
type MapRobotParams = { Params: { id: string; robotId: string } };

const notFound = (reply: AppFastifyReply, message: string) =>
  reply.status(404).send({ success: false, code: 'NOT_FOUND', error: message });

type HeldMap = { id: string; name: string; filename: string; features: unknown };

// For one robot: the stem the map would get there, and any mission it would duplicate.
const previewFor = (
  map: HeldMap,
  robot: { id: string; ipAddress: string | null; mappingBridgePort: number | null },
  held: { mapId: string; filename: string | null }[],
  mapsById: Map<string, HeldMap>
) => {
  const others = held.filter(link => link.mapId !== map.id);
  const otherMaps = others.flatMap(link => mapsById.get(link.mapId) ?? []);
  const taken = new Set(
    others.map(link => stemOf(link.filename ?? mapsById.get(link.mapId)?.filename ?? ''))
  );
  const preferred = stemOf(map.filename);
  const missionClashes = missionIdConflicts(
    map.features,
    otherMaps.map(other => other.features)
  );
  const clashMap = otherMaps.find(other =>
    missionIds(other.features).some(id => missionClashes.includes(id))
  );
  return {
    robotId: robot.id,
    holds: held.some(link => link.mapId === map.id),
    stem: freeStem(taken, preferred),
    ...(taken.has(preferred) ? { stemTaken: preferred } : {}),
    missionClashes,
    ...(clashMap ? { clashMapName: clashMap.name } : {}),
    hasMappingBridge: Boolean(robot.ipAddress && robot.mappingBridgePort),
    cannotReceiveMaps: robotCannotReceiveMaps(robot.id),
  };
};

const mapAssignmentRoutes = async (server: AppFastifyInstance) => {
  server.addHook('onRequest', requireActiveSession);

  server.get<MapParams>('/maps/:id/assignment-preview', async (request, reply) => {
    const { id } = request.params;
    const [map, robots, links] = await Promise.all([
      request.db.map.findUnique({
        where: { id },
        select: { id: true, name: true, filename: true, features: true },
      }),
      request.db.robot.findMany({
        select: { id: true, ipAddress: true, mappingBridgePort: true },
      }),
      request.db.robotMap.findMany({ select: { robotId: true, mapId: true, filename: true } }),
    ]);
    if (!map) return notFound(reply, 'Map not found');
    const held = await request.db.map.findMany({
      where: { id: { in: [...new Set(links.map(link => link.mapId))] } },
      select: { id: true, name: true, filename: true, features: true },
    });
    const mapsById = new Map(held.map(entry => [entry.id, entry]));
    return {
      success: true,
      data: robots.map(robot =>
        previewFor(
          map,
          robot,
          links.filter(link => link.robotId === robot.id),
          mapsById
        )
      ),
    };
  });

  server.get<MapRobotParams>('/maps/:id/robots/:robotId/conflict', async (request, reply) => {
    const { id, robotId } = request.params;
    const [map, link] = await Promise.all([
      request.db.map.findUnique({
        where: { id },
        select: {
          name: true,
          editedAt: true,
          editedBy: true,
          imageSha256: true,
          metadata: true,
          features: true,
        },
      }),
      request.db.robotMap.findFirst({
        where: { mapId: id, robotId },
        select: { conflictRevision: true, conflictCopy: true, syncedAt: true },
      }),
    ]);
    if (!map || !link?.conflictRevision) return notFound(reply, 'No conflict on this robot');
    const copy = isRecord(link.conflictCopy) ? link.conflictCopy : {};
    return {
      success: true,
      data: {
        ours: {
          editedAt: map.editedAt,
          editedBy: map.editedBy,
          imageSha256: map.imageSha256,
          yaml: map.metadata,
          features: map.features,
        },
        robot: {
          at: copy['at'] ?? link.syncedAt,
          imageSha256: copy['imageSha256'] ?? null,
          yaml: copy['yaml'] ?? null,
          features: copy['features'] ?? null,
        },
      },
    };
  });
};

export default mapAssignmentRoutes;
