import type { Prisma, PrismaClient } from '@prisma/client';
import { generateMapAssets } from './mapAssets.js';
import { storedImage } from './mapImage.js';
import { canonicalJson, decideRobotCopy, mapRevision, sha256 } from './mapRevision.js';
import {
  asMapFiles,
  extractMapContent,
  getMapDetails,
  looksLikeFilename,
  type MapSyncLogger,
  parseMapMetadata,
  UNSAFE_MAP_FILENAME,
} from './mapSyncPayload.js';

// What map syncing needs from Fastify; tests pass a plain object.
export type MapSyncHost = { log: MapSyncLogger; prisma: PrismaClient };

// Resolving a conflict in the robot's favour accepts its copy of this one map, once.
export type ImportOptions = { acceptRobotMapId?: string | undefined };

export const orgIdOfRobot = async (prisma: PrismaClient, robotId: string): Promise<string> => {
  const robot = await prisma.robot.findUnique({ where: { id: robotId }, select: { orgId: true } });
  if (!robot?.orgId) throw new Error(`Robot ${robotId} has no organization`);
  return robot.orgId;
};

// One map file as a robot holds it, identified by its revision.
export type RobotCopy = {
  filename: string;
  name: string;
  imageSha256: string;
  yaml: Record<string, unknown>;
  features: Prisma.InputJsonObject;
  revision: string;
};

export const robotCopyOf = (
  details: Omit<RobotCopy, 'revision' | 'imageSha256'>,
  imageSha256: string
): RobotCopy => ({
  ...details,
  imageSha256,
  revision: mapRevision({ imageSha256, yaml: details.yaml, features: details.features }),
});

// A robot holds one map per filename. Links from before filenames were recorded use the map's own.
export const findRobotLink = (prisma: PrismaClient, robotId: string, filename: string) =>
  prisma.robotMap.findFirst({
    where: {
      robotId,
      OR: [
        { filename },
        { filename: { isSet: false }, map: { filename } },
        { filename: null, map: { filename } },
      ],
    },
    select: {
      mapId: true,
      filename: true,
      pushedRevision: true,
      conflictRevision: true,
      map: { select: { revision: true, editedAt: true, imageSha256: true, metadata: true } },
    },
  });

// A robot can hold a map only once, so one it already holds under another filename doesn't count.
export const findMapByRevision = (
  prisma: PrismaClient,
  orgId: string,
  revision: string,
  robotId: string
) =>
  prisma.map.findFirst({
    where: { orgId, revision, robotMaps: { none: { robotId } } },
    select: { id: true, contentHash: true },
  });

const isLinkedToAnotherRobot = async (prisma: PrismaClient, mapId: string, robotId: string) =>
  (await prisma.robotMap.count({ where: { mapId, robotId: { not: robotId } } })) > 0;

// Link a map to a robot via the RobotMap join and record what the robot holds. A map replacing
// another takes over its link, keeping the active and pinned state. Otherwise does not touch
// isActive — active designation is centralized in designateActiveAfterSync.
export const linkMapToRobot = async (
  prisma: PrismaClient,
  robotId: string,
  mapId: string,
  replacedMapId: string | null,
  holds: { filename: string; pushedRevision: string }
) => {
  const recorded = { ...holds, conflictRevision: null, syncedAt: new Date() };
  if (replacedMapId && replacedMapId !== mapId) {
    // ponytail: a replaced map that no robot links to stays in the organization's list. Delete it
    // here if those pile up.
    await prisma.$transaction([
      prisma.robotMap.update({
        where: { robotId_mapId: { robotId, mapId: replacedMapId } },
        data: { mapId, ...recorded },
      }),
      prisma.robot.updateMany({ where: { id: robotId, mapId: replacedMapId }, data: { mapId } }),
    ]);
    return;
  }

  await prisma.robotMap.upsert({
    where: { robotId_mapId: { robotId, mapId } },
    update: recorded,
    create: {
      orgId: await orgIdOfRobot(prisma, robotId),
      robotId,
      mapId,
      isActive: false,
      isPinned: false,
      ...holds,
    },
  });
};

// Decide the robot's active map after a sync without clobbering a manual choice:
// respect a pinned row, keep any existing active map, and only fall back to the
// primary when the robot has no active assignment yet (first sync / active gone).
export const designateActiveAfterSync = async (
  prisma: PrismaClient,
  robotId: string,
  primaryMapId: string
) => {
  const rows = await prisma.robotMap.findMany({ where: { robotId } });
  if (rows.some(row => row.isPinned)) return;
  if (rows.some(row => row.isActive)) return;

  await prisma.$transaction([
    prisma.robotMap.updateMany({ where: { robotId }, data: { isActive: false } }),
    prisma.robotMap.update({
      where: { robotId_mapId: { robotId, mapId: primaryMapId } },
      data: { isActive: true },
    }),
    prisma.robot.update({ where: { id: robotId }, data: { mapId: primaryMapId } }),
  ]);
};

const sameYaml = (a: unknown, b: Record<string, unknown>) => {
  const { image: _a, ...left } = (a ?? {}) as Record<string, unknown>;
  const { image: _b, ...right } = b;
  return canonicalJson(left) === canonicalJson(right);
};

type StoredContent = Prisma.MapUncheckedUpdateInput & Prisma.MapUncheckedCreateInput;
type CopyContent = () => Promise<Omit<StoredContent, 'orgId' | 'filename' | 'name'>>;
type RobotLink = NonNullable<Awaited<ReturnType<typeof findRobotLink>>>;

// Rules 1, 2 and 4: the robot holds ours, an older one we sent, or a copy that conflicts. Returns
// whether the link settled it; rule 3 and a first sight fall through to storing the robot's copy.
const settleByLink = async (
  host: MapSyncHost,
  robotId: string,
  link: RobotLink,
  copy: RobotCopy,
  options: ImportOptions
) => {
  const decision = decideRobotCopy({
    incomingRev: copy.revision,
    currentRev: link.map?.revision ?? null,
    pushedRev: link.pushedRevision ?? null,
    edited: Boolean(link.map?.editedAt),
    acceptRobot: options.acceptRobotMapId === link.mapId,
  });
  host.log.info(
    { robotId, mapId: link.mapId, filename: copy.filename, decision },
    'Import rule applied'
  );
  if (decision === 'take_robot') return false;
  const recorded = {
    up_to_date: { pushedRevision: copy.revision, conflictRevision: null },
    behind: {},
    conflict: {
      conflictRevision: copy.revision,
      conflictCopy: {
        features: copy.features,
        imageSha256: copy.imageSha256,
        yaml: copy.yaml,
        at: new Date().toISOString(),
      } as Prisma.InputJsonObject,
    },
  }[decision];
  await host.prisma.robotMap.update({
    where: { robotId_mapId: { robotId, mapId: link.mapId } },
    data: { filename: copy.filename, syncedAt: new Date(), ...recorded },
  });
  return true;
};

// Stores the robot's copy: an identical record anywhere in the organization is reused; otherwise
// the robot's own record changes, or a new one is made when another robot still relies on it.
const storeRobotCopy = async (
  host: MapSyncHost,
  robotId: string,
  link: RobotLink | null,
  copy: RobotCopy,
  content: CopyContent | undefined
) => {
  const { prisma } = host;
  const orgId = await orgIdOfRobot(prisma, robotId);
  const same = await findMapByRevision(prisma, orgId, copy.revision, robotId);
  if (same) return same.id;

  const own =
    link && !(await isLinkedToAnotherRobot(prisma, link.mapId, robotId)) ? link.mapId : null;
  if (
    own &&
    link?.map?.imageSha256 === copy.imageSha256 &&
    sameYaml(link.map.metadata, copy.yaml)
  ) {
    // Only the features changed, so the image and its display assets stay.
    await prisma.map.update({
      where: { id: own },
      data: { features: copy.features, revision: copy.revision },
    });
    return own;
  }
  if (!content) return null;
  const data = await content();
  // ponytail: robots first syncing one new map in the same instant race on the unique index. The
  // loser's sync fails visibly and its next sync joins the winner's record.
  if (own) return (await prisma.map.update({ where: { id: own }, data })).id;
  const created = await prisma.map.create({
    data: { orgId, filename: copy.filename, name: copy.name, ...data },
  });
  return created.id;
};

// The import rules for one map file a robot holds (services/mapRevision.ts). A dashboard edit is
// never overwritten: when both sides changed, the link records a conflict. Returns the map the
// robot's file belongs to, or null when the robot's copy must be stored and its image is not here
// yet (a manifest before its chunks).
export const settleRobotCopy = async (
  host: MapSyncHost,
  robotId: string,
  copy: RobotCopy,
  options: ImportOptions & { content?: CopyContent } = {}
): Promise<string | null> => {
  const link = await findRobotLink(host.prisma, robotId, copy.filename);
  if (link && (await settleByLink(host, robotId, link, copy, options))) return link.mapId;

  const mapId = await storeRobotCopy(host, robotId, link, copy, options.content);
  if (!mapId) return null;
  await linkMapToRobot(host.prisma, robotId, mapId, link?.mapId ?? null, {
    filename: copy.filename,
    pushedRevision: copy.revision,
  });
  return mapId;
};

export const upsertSingleMap = async (
  host: MapSyncHost,
  robotId: string,
  input: unknown,
  options: ImportOptions = {}
) => {
  const logger = host.log;
  const { prisma } = host;
  const files = asMapFiles(input);

  if (!files?.map_yaml || !files?.map_pgm) {
    logger.warn({ robotId, files: input }, 'MAP_DATA_RESPONSE missing map files');
    return null;
  }
  if (
    typeof files.map_yaml === 'string' &&
    looksLikeFilename(files.map_yaml, '.yaml') &&
    UNSAFE_MAP_FILENAME.test(files.map_yaml)
  ) {
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
    const copy = robotCopyOf({ filename, name, yaml: metadata, features }, sha256(pgmBytes));
    const mapId = await settleRobotCopy(host, robotId, copy, {
      ...options,
      content: async () => ({
        image: storedImage(pgmBytes),
        // Parsed from the robot's map.yaml, so it is plain data.
        metadata: metadata as Prisma.InputJsonObject,
        features,
        imageSha256: copy.imageSha256,
        revision: copy.revision,
        ...generatedAssets,
      }),
    });
    const map = mapId ? await prisma.map.findUnique({ where: { id: mapId } }) : null;
    if (map) logger.info({ robotId, mapId: map.id, filename }, 'Map upserted from mapping bridge');
    return map;
  } catch (err) {
    logger.error({ robotId, err }, 'Failed to upsert map from mapping bridge');
    return null;
  }
};

// files: { map_yaml, map_pgm, map_yaml_content?, map_pgm_content?, metadata_json?, additional_maps? }
export const upsertMapFromResponse = async (
  host: MapSyncHost,
  robotId: string,
  input: unknown,
  options: ImportOptions = {}
) => {
  if (!input) return;

  // Link the primary map and every additional map to the robot via RobotMap.
  const primaryMap = await upsertSingleMap(host, robotId, input, options);

  const additionalMaps = asMapFiles(input)?.additional_maps;
  if (Array.isArray(additionalMaps)) {
    for (const extra of additionalMaps) {
      await upsertSingleMap(host, robotId, extra, options);
    }
  }

  // Designate the primary as active without clobbering a pinned / existing choice.
  if (primaryMap) {
    await designateActiveAfterSync(host.prisma, robotId, primaryMap.id);
  }

  return primaryMap;
};
