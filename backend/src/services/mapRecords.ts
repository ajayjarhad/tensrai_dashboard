import { generateMapAssets } from './mapAssets.js';
import {
  extractMapContent,
  getMapDetails,
  looksLikeFilename,
  parseMapMetadata,
  UNSAFE_MAP_FILENAME,
} from './mapSyncPayload.js';

export const orgIdOfRobot = async (prisma: any, robotId: string): Promise<string> => {
  const robot = await prisma.robot.findUnique({ where: { id: robotId }, select: { orgId: true } });
  if (!robot?.orgId) throw new Error(`Robot ${robotId} has no organization`);
  return robot.orgId;
};

// Most robots sync a map.yaml, so robots share a record only when the content matches too. The
// filename stays in the identity because robotStatusSync finds a robot's map by that filename.
// ponytail: features live on the record, so robots sharing one share missions and the last sync
// wins. Fork on differing features if robots on one floor ever need different missions.
export const findMapByContent = (prisma: any, orgId: string, filename: string, hashes: string[]) =>
  prisma.map.findFirst({
    where: { orgId, filename, contentHash: { in: hashes } },
    select: { id: true, contentHash: true },
  });

// A robot holds one map per filename, and syncing that filename again replaces it.
export const findLinkedMapId = async (prisma: any, robotId: string, filename: string) => {
  const link = await prisma.robotMap.findFirst({
    where: { robotId, map: { filename } },
    select: { mapId: true },
  });
  return link?.mapId ?? null;
};

const isLinkedToAnotherRobot = async (prisma: any, mapId: string, robotId: string) =>
  (await prisma.robotMap.count({ where: { mapId, robotId: { not: robotId } } })) > 0;

// Link a map to a robot via the RobotMap join, refreshing syncedAt. A map replacing another takes
// over its link, keeping the active and pinned state. Otherwise does not touch isActive — active
// designation is centralized in designateActiveAfterSync.
export const linkMapToRobot = async (
  prisma: any,
  robotId: string,
  mapId: string,
  replacedMapId: string | null
) => {
  if (replacedMapId && replacedMapId !== mapId) {
    // ponytail: a replaced map that no robot links to stays in the organization's list. Delete it
    // here if those pile up.
    await prisma.$transaction([
      prisma.robotMap.update({
        where: { robotId_mapId: { robotId, mapId: replacedMapId } },
        data: { mapId, syncedAt: new Date() },
      }),
      prisma.robot.updateMany({ where: { id: robotId, mapId: replacedMapId }, data: { mapId } }),
    ]);
    return;
  }

  await prisma.robotMap.upsert({
    where: { robotId_mapId: { robotId, mapId } },
    update: { syncedAt: new Date() },
    create: {
      orgId: await orgIdOfRobot(prisma, robotId),
      robotId,
      mapId,
      isActive: false,
      isPinned: false,
    },
  });
};

// Decide the robot's active map after a sync without clobbering a manual choice:
// respect a pinned row, keep any existing active map, and only fall back to the
// primary when the robot has no active assignment yet (first sync / active gone).
export const designateActiveAfterSync = async (
  prisma: any,
  robotId: string,
  primaryMapId: string
) => {
  const rows = await prisma.robotMap.findMany({ where: { robotId } });
  if (rows.some((row: any) => row.isPinned)) return;
  if (rows.some((row: any) => row.isActive)) return;

  await prisma.$transaction([
    prisma.robotMap.updateMany({ where: { robotId }, data: { isActive: false } }),
    prisma.robotMap.update({
      where: { robotId_mapId: { robotId, mapId: primaryMapId } },
      data: { isActive: true },
    }),
    prisma.robot.update({ where: { id: robotId }, data: { mapId: primaryMapId } }),
  ]);
};

export const upsertSingleMap = async (fastify: any, robotId: string, files: any) => {
  const logger = fastify.log;
  const prisma = fastify.prisma as any;

  if (!files?.map_yaml || !files?.map_pgm) {
    logger.warn({ robotId, files }, 'MAP_DATA_RESPONSE missing map files');
    return null;
  }
  if (looksLikeFilename(files.map_yaml, '.yaml') && UNSAFE_MAP_FILENAME.test(files.map_yaml)) {
    logger.warn({ robotId, filename: files.map_yaml }, 'Refusing map with an unsafe filename');
    return null;
  }

  const { yamlText, pgmBytes, hasYamlContent, hasPgmContent } = extractMapContent(
    files,
    logger,
    robotId
  );

  if (!yamlText || !pgmBytes) {
    logger.error(
      { robotId, hasYamlContent, hasPgmContent },
      'Mapping payload missing inline content; aborting'
    );
    return null;
  }

  const metadata = parseMapMetadata(yamlText, logger, robotId);
  if (!metadata) return null;
  const { features, filename, name } = getMapDetails(files);
  const generatedAssets = await generateMapAssets(pgmBytes, metadata);
  // Not a readable image: storing it would replace a good floor with one nobody can display.
  if (!generatedAssets.pixelWidth) {
    logger.error(
      { robotId, filename, error: generatedAssets.displayGenerationError },
      'Refusing map with an unreadable image'
    );
    return null;
  }
  if (generatedAssets.displayGenerationError) {
    logger.warn(
      {
        robotId,
        filename,
        contentHash: generatedAssets.contentHash.slice(0, 12),
        error: generatedAssets.displayGenerationError,
      },
      'Map display asset generation had fallback errors'
    );
  }

  try {
    const orgId = await orgIdOfRobot(prisma, robotId);
    const linkedMapId = await findLinkedMapId(prisma, robotId, filename);
    const sameContent = await findMapByContent(prisma, orgId, filename, [
      generatedAssets.contentHash,
    ]);
    // Changed content updates the robot's own record, unless another robot still relies on it.
    const ownMapId =
      linkedMapId && !(await isLinkedToAnotherRobot(prisma, linkedMapId, robotId))
        ? linkedMapId
        : null;
    const targetMapId = sameContent?.id ?? ownMapId;

    const content = { name, image: pgmBytes, metadata, features, ...generatedAssets };
    // ponytail: robots first syncing one new map in the same instant race on the unique index. The
    // loser's sync fails visibly and its next sync joins the winner's record.
    const map = targetMapId
      ? await prisma.map.update({ where: { id: targetMapId }, data: content })
      : await prisma.map.create({ data: { orgId, filename, ...content } });

    await linkMapToRobot(prisma, robotId, map.id, linkedMapId);

    logger.info({ robotId, mapId: map.id, filename }, 'Map upserted from mapping bridge');
    return map;
  } catch (err) {
    logger.error({ robotId, err }, 'Failed to upsert map from mapping bridge');
    return null;
  }
};

// files: { map_yaml, map_pgm, map_yaml_content?, map_pgm_content?, metadata_json?, additional_maps? }
export const upsertMapFromResponse = async (fastify: any, robotId: string, files: any) => {
  if (!files) return;
  const prisma = fastify.prisma as any;

  // Link the primary map and every additional map to the robot via RobotMap.
  const primaryMap = await upsertSingleMap(fastify, robotId, files);

  if (Array.isArray(files.additional_maps)) {
    for (const extra of files.additional_maps) {
      await upsertSingleMap(fastify, robotId, extra);
    }
  }

  // Designate the primary as active without clobbering a pinned / existing choice.
  if (primaryMap) {
    await designateActiveAfterSync(prisma, robotId, primaryMap.id);
  }

  return primaryMap;
};
