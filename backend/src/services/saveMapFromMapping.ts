// @ts-nocheck
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import yaml from 'js-yaml';
import WebSocket from 'ws';
import { generateMapAssets } from './mapAssets.js';
import { isAddressApproved } from './robotAddress.js';

const MAP_TRANSFER_ACTIVITY_TIMEOUT_MS = 45_000;
const DEFAULT_MAP_SYNC_CONNECT_TIMEOUT_MS = 15_000;

const MAP_SYNC_FAILED = 'Map sync failed. Try again.';
const UNREADABLE_MAP_FILES = 'Robot map files could not be read';
const BRIDGE_CONNECTION_FAILED = "Connection to the robot's mapping bridge failed";

// A failure whose message is written for the user. Any other exception stays in the logs: the sync
// status reaches every member of the organization, the robot can be a server that organization
// runs, and Prisma's text carries source paths and the database's address.
class MapSyncFailure extends Error {}

type MapSyncStatus = {
  phase:
    | 'idle'
    | 'connecting'
    | 'manifest'
    | 'skipped'
    | 'receiving'
    | 'processing'
    | 'complete'
    | 'failed';
  robotId: string;
  mapId?: string;
  mapName?: string;
  filename?: string;
  contentHash?: string;
  bytesReceived: number;
  totalBytes?: number;
  percent?: number;
  startedAt: number;
  updatedAt: number;
  elapsedMs: number;
  lastError?: string;
};

const mapSyncStatusByRobot = new Map<string, MapSyncStatus>();
const ACTIVE_MAP_SYNC_PHASES = new Set(['connecting', 'manifest', 'receiving', 'processing']);

const updateMapSyncStatus = (
  robotId: string,
  update: Partial<Omit<MapSyncStatus, 'robotId' | 'startedAt'>>
) => {
  const previous = mapSyncStatusByRobot.get(robotId);
  const startedAt = previous?.startedAt ?? Date.now();
  const next: MapSyncStatus = {
    phase: 'idle',
    bytesReceived: 0,
    ...previous,
    ...update,
    robotId,
    startedAt,
    updatedAt: Date.now(),
    elapsedMs: Date.now() - startedAt,
  };
  mapSyncStatusByRobot.set(robotId, next);
  return next;
};

export const getMapSyncStatus = (robotId: string): MapSyncStatus => {
  const current = mapSyncStatusByRobot.get(robotId);
  if (!current) {
    return {
      phase: 'idle',
      robotId,
      bytesReceived: 0,
      percent: 0,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      elapsedMs: 0,
    };
  }
  return {
    ...current,
    elapsedMs: Date.now() - current.startedAt,
  };
};

export const isMapSyncActive = (status: Pick<MapSyncStatus, 'phase'> | null | undefined) =>
  Boolean(status && ACTIVE_MAP_SYNC_PHASES.has(status.phase));

const resolveMapSyncConnectTimeoutMs = (fastify: any) => {
  const configured = Number(
    fastify?.mapSyncConnectTimeoutMs ?? process.env.MAP_SYNC_CONNECT_TIMEOUT_MS
  );
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_MAP_SYNC_CONNECT_TIMEOUT_MS;
};

const looksLikeFilename = (value: unknown, ext: string) =>
  typeof value === 'string' && value.trim().toLowerCase().endsWith(ext) && !value.includes('\n');

// Filenames come from the robot and are shown across the dashboard.
const UNSAFE_MAP_FILENAME = /[/\\<>\p{Cc}]|\.\./u;

const isBase64 = (value: string) => {
  if (!value || typeof value !== 'string') return false;
  const normalized = value.replace(/\s+/g, '');
  return normalized.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(normalized);
};

const decodeToBuffer = (raw: unknown): Buffer | null => {
  if (raw instanceof Buffer) return raw;
  if (typeof raw !== 'string') return null;
  try {
    if (isBase64(raw)) return Buffer.from(raw, 'base64');
    return Buffer.from(raw, 'binary');
  } catch {
    return null;
  }
};

const extractMapContent = (files: any, logger: any, robotId: string) => {
  const mapYamlRaw = files.map_yaml_content ?? files.map_yaml;
  const mapPgmRaw = files.map_pgm_content ?? files.map_pgm;

  logger.info(
    {
      robotId,
      mapYamlType: typeof mapYamlRaw,
      mapPgmType: typeof mapPgmRaw,
      mapYamlSample: typeof mapYamlRaw === 'string' ? mapYamlRaw.slice(0, 64) : undefined,
      mapPgmLength:
        typeof mapPgmRaw === 'string'
          ? mapPgmRaw.length
          : mapPgmRaw instanceof Buffer
            ? mapPgmRaw.length
            : undefined,
    },
    'Mapping payload field types'
  );

  let yamlText: string | undefined;
  let pgmBytes: Buffer | null = null;

  const hasYamlContent =
    typeof mapYamlRaw === 'string' &&
    (!looksLikeFilename(mapYamlRaw, '.yaml') || mapYamlRaw.includes('\n'));
  const hasPgmContent =
    mapPgmRaw instanceof Buffer ||
    (typeof mapPgmRaw === 'string' &&
      (!looksLikeFilename(mapPgmRaw, '.pgm') || isBase64(mapPgmRaw)));

  if (hasYamlContent) {
    yamlText = mapYamlRaw as string;
    logger.info(
      { robotId, source: 'inline', yamlLength: yamlText.length },
      'Using inline map YAML'
    );
  }
  if (hasPgmContent) {
    pgmBytes = decodeToBuffer(mapPgmRaw);
    logger.info({ robotId, source: 'inline', pgmBytes: pgmBytes?.length }, 'Using inline map PGM');
  }

  return { yamlText, pgmBytes, hasYamlContent, hasPgmContent };
};

const parseMapMetadata = (yamlText: string, logger: any, robotId: string) => {
  try {
    const metadata = yaml.load(yamlText);
    if (metadata && typeof metadata === 'object') return metadata as any;
    logger.error({ robotId }, 'Map YAML is not a mapping');
  } catch (err) {
    logger.error({ robotId, err }, 'Failed to parse map YAML');
  }
  return null;
};

const normalizeFeatures = (features: any) => {
  const input = features && typeof features === 'object' ? features : {};
  const rawLocationTags = Array.isArray(input.locationTags) ? input.locationTags : [];
  const rawMissions = Array.isArray(input.missions) ? input.missions : [];

  const locationTags = rawLocationTags.map((tag: any, index: number) => {
    const id = tag?.id ?? tag?.tagId ?? index + 1;
    return {
      ...tag,
      id: String(id),
    };
  });

  const missions = rawMissions.map((mission: any, index: number) => {
    const id = mission?.id ?? mission?.missionId ?? mission?.missionID ?? index + 1;
    const name = mission?.name ?? `Mission ${id}`;
    const locationTagId = Array.isArray(mission?.locationTagId)
      ? mission.locationTagId.map((value: any) => String(value))
      : undefined;
    const steps = Array.isArray(mission?.steps)
      ? mission.steps.map((value: any) => String(value))
      : (locationTagId ?? []);

    return {
      ...mission,
      id: String(id),
      name,
      steps,
      ...(locationTagId ? { locationTagId } : {}),
    };
  });

  return {
    ...input,
    locationTags,
    missions,
  };
};

// A robot decides what it sends, and any organization can point a robot at its own server. These
// bound what one transfer can make this process hold, since every customer shares it.
const MAX_MAP_TRANSFER_BYTES = 64 * 1024 * 1024;
const MAX_MAP_IMAGE_BYTES = 256 * 1024 * 1024;

const gunzipMapImage = (gzipBytes: Buffer, maxOutputLength: number) => {
  try {
    return gunzipSync(gzipBytes, { maxOutputLength });
  } catch (err) {
    throw new MapSyncFailure(UNREADABLE_MAP_FILES, { cause: err });
  }
};

const getMapDetails = (files: any) => {
  const features = normalizeFeatures(files.metadata_json ?? {});
  const filename = looksLikeFilename(files.map_yaml, '.yaml') ? files.map_yaml : 'map.yaml';
  const name = filename.replace(/\.yaml$/i, '') || filename;
  return { features, filename, name };
};

const hasFeaturePayload = (value: any) => value && Object.hasOwn(value, 'metadata_json');

const getFeaturePayload = (value: any) => value?.metadata_json ?? {};

const orgIdOfRobot = async (prisma: any, robotId: string): Promise<string> => {
  const robot = await prisma.robot.findUnique({ where: { id: robotId }, select: { orgId: true } });
  if (!robot?.orgId) throw new Error(`Robot ${robotId} has no organization`);
  return robot.orgId;
};

// Most robots sync a map.yaml, so robots share a record only when the content matches too. The
// filename stays in the identity because robotStatusSync finds a robot's map by that filename.
// ponytail: features live on the record, so robots sharing one share missions and the last sync
// wins. Fork on differing features if robots on one floor ever need different missions.
const findMapByContent = (prisma: any, orgId: string, filename: string, hashes: string[]) =>
  prisma.map.findFirst({
    where: { orgId, filename, contentHash: { in: hashes } },
    select: { id: true, contentHash: true },
  });

// A robot holds one map per filename, and syncing that filename again replaces it.
const findLinkedMapId = async (prisma: any, robotId: string, filename: string) => {
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
const linkMapToRobot = async (
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
const designateActiveAfterSync = async (prisma: any, robotId: string, primaryMapId: string) => {
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

const upsertSingleMap = async (fastify: any, robotId: string, files: any) => {
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

// Connects to the mapping bridge, requests map data, and upserts it.
export const fetchMapViaMappingBridge = async (
  fastify: any,
  robot: {
    id: string;
    orgId?: string;
    ipAddress?: string | null;
    mappingBridgePort?: number | null;
  }
) => {
  const logger = fastify.log;
  const prisma = fastify.prisma as any;
  const robotId = robot.id;
  if (!robot.ipAddress || !robot.mappingBridgePort) {
    logger.warn({ robotId }, 'Cannot fetch map: mapping bridge not configured');
    return;
  }
  if (!(await isAddressApproved(prisma, robot))) {
    logger.info({ robotId }, 'Cannot fetch map: robot address is not approved');
    return;
  }

  const currentStatus = mapSyncStatusByRobot.get(robotId);
  if (isMapSyncActive(currentStatus)) {
    logger.info(
      { robotId, phase: currentStatus?.phase },
      'Map sync already active; reusing status'
    );
    return getMapSyncStatus(robotId);
  }

  const targetUrl = `ws://${robot.ipAddress}:${robot.mappingBridgePort}`;
  logger.info({ robotId, targetUrl }, 'Connecting to mapping bridge to fetch map');

  mapSyncStatusByRobot.delete(robotId);
  updateMapSyncStatus(robotId, {
    phase: 'connecting',
    bytesReceived: 0,
    percent: 0,
    lastError: undefined,
  });

  const socket = new WebSocket(targetUrl);
  const connectTimeout = setTimeout(() => {
    const current = mapSyncStatusByRobot.get(robotId);
    if (current?.phase === 'connecting') {
      markFailed('map-sync-connect-timeout');
    }
  }, resolveMapSyncConnectTimeoutMs(fastify));
  const transfers = new Map<
    string,
    {
      manifest: any;
      chunks: Buffer[];
      receivedChunks: Set<number>;
      bytesReceived: number;
    }
  >();
  let activityTimeout: NodeJS.Timeout | undefined;
  let ended = false;

  const stop = (reason?: string) => {
    ended = true;
    clearTimeout(connectTimeout);
    if (activityTimeout) clearTimeout(activityTimeout);
    try {
      socket.close();
    } catch {}
    if (reason) logger.info({ robotId, reason }, 'Mapping fetch socket closed');
  };

  const markFailed = (reason: string) => {
    updateMapSyncStatus(robotId, {
      phase: 'failed',
      lastError: reason,
    });
    stop(reason);
  };

  const resetActivityTimeout = () => {
    if (activityTimeout) clearTimeout(activityTimeout);
    activityTimeout = setTimeout(() => {
      const current = mapSyncStatusByRobot.get(robotId);
      if (current?.phase === 'complete' || current?.phase === 'skipped') {
        stop('map-transfer-idle-complete');
        return;
      }
      markFailed('map-transfer-activity-timeout');
    }, MAP_TRANSFER_ACTIVITY_TIMEOUT_MS);
  };

  const sendEvent = (event: string, payload: any) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ event, payload }));
  };

  // Always links: the record may be another robot's, which this robot has never been linked to.
  const linkExistingMapToRobot = async (mapId: string, filename: string, isDefault: boolean) => {
    await linkMapToRobot(prisma, robotId, mapId, await findLinkedMapId(prisma, robotId, filename));
    if (isDefault) await designateActiveAfterSync(prisma, robotId, mapId);
  };

  const updateExistingMapFeatures = async (mapId: string, manifest: any) => {
    if (!hasFeaturePayload(manifest)) return false;
    const features = normalizeFeatures(getFeaturePayload(manifest));
    await prisma.map.update({ where: { id: mapId }, data: { features } });
    return true;
  };

  const finalizeChunkedTransfer = async (transferId: string) => {
    const transfer = transfers.get(transferId);
    if (!transfer) return;
    const { manifest } = transfer;
    const totalChunks = Number(manifest.total_chunks ?? manifest.totalChunks ?? 0);
    if (transfer.receivedChunks.size < totalChunks) return;
    if (activityTimeout) clearTimeout(activityTimeout);

    updateMapSyncStatus(robotId, {
      phase: 'processing',
      filename: manifest.map_yaml,
      mapName: manifest.name,
      contentHash: manifest.contentHash ?? manifest.sha256,
      bytesReceived: transfer.bytesReceived,
      totalBytes: Number(manifest.gzip_size ?? transfer.bytesReceived),
      percent: 100,
    });

    try {
      const gzipBytes = Buffer.concat(transfer.chunks);
      const pgmBytes = gunzipMapImage(gzipBytes, fastify?.maxMapImageBytes ?? MAX_MAP_IMAGE_BYTES);
      const actualHash = createHash('sha256').update(pgmBytes).digest('hex');
      if (actualHash !== manifest.sha256) {
        throw new MapSyncFailure(`sha256 mismatch: expected ${manifest.sha256}, got ${actualHash}`);
      }

      const storedMap = await upsertSingleMap(fastify, robotId, {
        name: manifest.name,
        map_yaml: manifest.map_yaml,
        map_pgm: manifest.map_pgm,
        map_yaml_content: manifest.map_yaml_content,
        map_pgm_content: pgmBytes,
        metadata_json: manifest.metadata_json,
      });
      if (!storedMap) {
        throw new MapSyncFailure('Map upsert failed');
      }

      const isDefaultMap = Boolean(manifest.is_default ?? manifest.isDefault ?? true);
      if (isDefaultMap) {
        await designateActiveAfterSync(prisma, robotId, storedMap.id);
      }

      transfers.delete(transferId);
      const storedContentHash = storedMap.contentHash ?? manifest.contentHash ?? manifest.sha256;
      updateMapSyncStatus(robotId, {
        phase: 'complete',
        mapId: storedMap.id,
        filename: manifest.map_yaml,
        mapName: manifest.name,
        contentHash: storedContentHash,
        bytesReceived: pgmBytes.length,
        totalBytes: pgmBytes.length,
        percent: 100,
        lastError: undefined,
      });
      sendEvent('MAP_TRANSFER_STORED', {
        transferId,
        sha256: manifest.sha256,
        contentHash: storedContentHash,
      });
      resetActivityTimeout();
    } catch (error) {
      const message = error instanceof MapSyncFailure ? error.message : MAP_SYNC_FAILED;
      logger.error({ robotId, transferId, err: error }, 'Failed to finalize chunked map transfer');
      sendEvent('MAP_TRANSFER_ERROR', { transferId, message });
      markFailed(message);
    }
  };

  socket.on('open', () => {
    try {
      clearTimeout(connectTimeout);
      resetActivityTimeout();
      socket.send(JSON.stringify({ event: 'GET_MAP_DATA', payload: {} }));
      logger.info({ robotId, targetUrl }, 'Sent GET_MAP_DATA via mapping bridge');
    } catch (err) {
      logger.error({ robotId, targetUrl, err }, 'Failed to send GET_MAP_DATA via mapping bridge');
      stop('send-error');
    }
  });

  socket.on('message', async (data, isBinary) => {
    if (ended) return;
    resetActivityTimeout();
    const payload =
      !isBinary && typeof data === 'string'
        ? data
        : Buffer.isBuffer(data)
          ? data.toString('utf8')
          : data;

    try {
      const parsed = typeof payload === 'string' ? JSON.parse(payload) : null;
      if (parsed?.event === 'MAP_MANIFEST' && parsed?.payload) {
        const manifest = parsed.payload;
        const transferId = String(manifest.transferId ?? manifest.transfer_id ?? manifest.sha256);
        const filename = String(manifest.map_yaml ?? 'map.yaml');
        const totalChunks = Number(manifest.total_chunks ?? manifest.totalChunks);
        const rawHash = manifest.sha256;
        if (!rawHash || !Number.isInteger(totalChunks) || totalChunks <= 0) {
          sendEvent('MAP_TRANSFER_ERROR', {
            transferId,
            message: 'invalid map transfer manifest',
          });
          markFailed('invalid map transfer manifest');
          return;
        }
        const expectedContentHash =
          manifest.contentHash ?? manifest.content_hash ?? manifest.map_content_hash;
        const existing = await findMapByContent(
          prisma,
          await orgIdOfRobot(prisma, robotId),
          filename,
          [expectedContentHash, rawHash].filter(Boolean)
        );
        // The sync can fail while that lookup runs; a late status here would read as still active.
        if (ended) return;
        if (existing) {
          const featuresUpdated = await updateExistingMapFeatures(existing.id, manifest);
          await linkExistingMapToRobot(
            existing.id,
            filename,
            manifest.is_default ?? manifest.isDefault ?? true
          );
          updateMapSyncStatus(robotId, {
            phase: 'skipped',
            mapId: existing.id,
            filename,
            mapName: manifest.name,
            contentHash: existing.contentHash,
            bytesReceived: 0,
            totalBytes: Number(manifest.gzip_size ?? 0),
            percent: 100,
            lastError: undefined,
          });
          sendEvent('MAP_SKIP', {
            transferId,
            reason: 'unchanged',
            contentHash: existing.contentHash,
            featuresUpdated,
          });
          return;
        }

        transfers.set(transferId, {
          manifest: { ...manifest, sha256: rawHash, contentHash: expectedContentHash },
          chunks: new Array(totalChunks),
          receivedChunks: new Set(),
          bytesReceived: 0,
        });
        updateMapSyncStatus(robotId, {
          phase: 'manifest',
          filename,
          mapName: manifest.name,
          contentHash: rawHash,
          bytesReceived: 0,
          totalBytes: Number(manifest.gzip_size ?? 0),
          percent: 0,
          lastError: undefined,
        });
        sendEvent('MAP_SEND_CHUNKS', { transferId });
        return;
      }

      if (parsed?.event === 'MAP_CHUNK' && parsed?.payload) {
        const chunkPayload = parsed.payload;
        const transferId = String(chunkPayload.transferId ?? chunkPayload.transfer_id);
        const transfer = transfers.get(transferId);
        if (!transfer) {
          sendEvent('MAP_TRANSFER_ERROR', { transferId, message: 'unknown transfer id' });
          return;
        }
        const chunkIndex = Number(chunkPayload.index ?? chunkPayload.chunk_index);
        const totalChunks = Number(transfer.manifest.total_chunks ?? transfer.manifest.totalChunks);
        if (
          !Number.isInteger(chunkIndex) ||
          chunkIndex < 0 ||
          !Number.isInteger(totalChunks) ||
          chunkIndex >= totalChunks
        ) {
          sendEvent('MAP_TRANSFER_ERROR', { transferId, message: 'invalid chunk index' });
          return;
        }
        if (!transfer.receivedChunks.has(chunkIndex)) {
          const chunk = Buffer.from(String(chunkPayload.data ?? ''), 'base64');
          if (transfer.bytesReceived + chunk.length > MAX_MAP_TRANSFER_BYTES) {
            sendEvent('MAP_TRANSFER_ERROR', { transferId, message: 'map transfer too large' });
            markFailed('map-transfer-too-large');
            return;
          }
          transfer.chunks[chunkIndex] = chunk;
          transfer.receivedChunks.add(chunkIndex);
          transfer.bytesReceived += chunk.length;
        }
        const totalBytes = Number(transfer.manifest.gzip_size ?? transfer.bytesReceived);
        updateMapSyncStatus(robotId, {
          phase: 'receiving',
          filename: transfer.manifest.map_yaml,
          mapName: transfer.manifest.name,
          contentHash: transfer.manifest.sha256,
          bytesReceived: transfer.bytesReceived,
          totalBytes,
          percent:
            totalBytes > 0
              ? Math.min(99, Math.round((transfer.bytesReceived / totalBytes) * 100))
              : undefined,
          lastError: undefined,
        });
        return;
      }

      if (parsed?.event === 'MAP_TRANSFER_COMPLETE' && parsed?.payload) {
        const transferId = String(parsed.payload.transferId ?? parsed.payload.transfer_id);
        await finalizeChunkedTransfer(transferId);
        return;
      }

      if (parsed?.event === 'MAP_BATCH_COMPLETE') {
        stop('map-batch-complete');
        return;
      }

      if (parsed?.event === 'MAP_TRANSFER_ERROR') {
        const message = parsed.payload?.message ?? 'robot reported map transfer error';
        logger.error({ robotId, message }, 'Robot map transfer failed');
        markFailed(message);
        return;
      }

      if (
        parsed?.event === 'ERROR' ||
        (parsed?.event === 'MAP_DATA_RESPONSE' && !parsed?.payload?.files)
      ) {
        markFailed(String(parsed.payload?.error ?? parsed.payload?.message ?? 'No map data'));
        return;
      }

      if (parsed?.event === 'MAP_DATA_RESPONSE') {
        logger.info({ robotId, targetUrl }, 'Received MAP_DATA_RESPONSE via mapping bridge');
        updateMapSyncStatus(robotId, {
          phase: 'processing',
          bytesReceived: 0,
          percent: undefined,
          lastError: undefined,
        });
        const storedMap = await upsertMapFromResponse(fastify, robotId, parsed.payload.files);
        if (!storedMap) {
          markFailed(UNREADABLE_MAP_FILES);
          return;
        }
        updateMapSyncStatus(robotId, {
          phase: 'complete',
          mapId: storedMap.id,
          percent: 100,
          lastError: undefined,
        });
        stop('map-upserted');
      }
    } catch (err) {
      logger.error({ robotId, err }, 'Failed to process mapping bridge payload');
      // Ending the sync keeps this to one log line per sync, whatever the robot sends next.
      markFailed(MAP_SYNC_FAILED);
    }
  });

  socket.on('error', err => {
    logger.error({ robotId, targetUrl, err }, 'Mapping bridge socket error');
    // Tearing the socket down after an earlier failure (e.g. the connect timeout) raises this
    // too; keep the first, real reason.
    if (mapSyncStatusByRobot.get(robotId)?.phase !== 'failed') {
      updateMapSyncStatus(robotId, { phase: 'failed', lastError: BRIDGE_CONNECTION_FAILED });
    }
    stop('error');
  });

  socket.on('close', () => {
    clearTimeout(connectTimeout);
    if (activityTimeout) clearTimeout(activityTimeout);
    const current = mapSyncStatusByRobot.get(robotId);
    if (isMapSyncActive(current)) {
      updateMapSyncStatus(robotId, {
        phase: 'failed',
        lastError: 'map-sync-connection-closed',
      });
    }
  });

  return getMapSyncStatus(robotId);
};
