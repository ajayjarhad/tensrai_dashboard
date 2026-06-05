// @ts-nocheck
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import yaml from 'js-yaml';
import WebSocket from 'ws';
import { generateMapAssets } from './mapAssets.js';

const MAP_TRANSFER_ACTIVITY_TIMEOUT_MS = 45_000;

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

const looksLikeFilename = (value: unknown, ext: string) =>
  typeof value === 'string' && value.trim().toLowerCase().endsWith(ext) && !value.includes('\n');

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
  let metadata: any;
  try {
    metadata = yaml.load(yamlText) ?? {};
  } catch (err) {
    logger.error({ robotId, err }, 'Failed to parse map YAML');
    metadata = {};
  }
  return metadata;
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

const getMapDetails = (files: any) => {
  const features = normalizeFeatures(files.metadata_json ?? {});
  const filename = looksLikeFilename(files.map_yaml, '.yaml') ? files.map_yaml : 'map.yaml';
  const name = filename.replace(/\.yaml$/i, '') || filename;
  return { features, filename, name };
};

const hasFeaturePayload = (value: any) => value && Object.hasOwn(value, 'metadata_json');

const getFeaturePayload = (value: any) => value?.metadata_json ?? {};

const upsertSingleMap = async (fastify: any, robotId: string, files: any, linkRobot: boolean) => {
  const logger = fastify.log;
  const prisma = fastify.prisma as any;

  if (!files?.map_yaml || !files?.map_pgm) {
    logger.warn({ robotId, files }, 'MAP_DATA_RESPONSE missing map files');
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
  const { features, filename, name } = getMapDetails(files);
  const generatedAssets = await generateMapAssets(pgmBytes, metadata);
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
    const map = await prisma.map.upsert({
      where: { filename },
      update: {
        name,
        image: pgmBytes,
        metadata,
        features,
        ...generatedAssets,
      },
      create: {
        name,
        filename,
        image: pgmBytes,
        metadata,
        features,
        ...generatedAssets,
      },
    });

    if (linkRobot) {
      await prisma.robot.update({
        where: { id: robotId },
        data: { map: { connect: { id: map.id } } },
      });
    }

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
  // Process primary map and link robot
  const primaryMap = await upsertSingleMap(fastify, robotId, files, true);

  // Process additional maps if provided (not linked to robot)
  if (Array.isArray(files.additional_maps)) {
    for (const extra of files.additional_maps) {
      await upsertSingleMap(fastify, robotId, extra, false);
    }
  }

  return primaryMap;
};

// Connects to the mapping bridge, requests map data, and upserts it.
export const fetchMapViaMappingBridge = async (
  fastify: any,
  robot: { id: string; ipAddress?: string | null; mappingBridgePort?: number | null }
) => {
  const logger = fastify.log;
  const prisma = fastify.prisma as any;
  const robotId = robot.id;
  if (!robot.ipAddress || !robot.mappingBridgePort) {
    logger.warn({ robotId }, 'Cannot fetch map: mapping bridge not configured');
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

  const stop = (reason?: string) => {
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

  const linkExistingMapToRobot = async (filename: string) => {
    const existing = await prisma.map.findUnique({ where: { filename }, select: { id: true } });
    if (!existing) return;
    await prisma.robot.update({
      where: { id: robotId },
      data: { map: { connect: { id: existing.id } } },
    });
  };

  const updateExistingMapFeatures = async (filename: string, manifest: any) => {
    if (!hasFeaturePayload(manifest)) return false;
    const features = normalizeFeatures(getFeaturePayload(manifest));
    await prisma.map.update({
      where: { filename },
      data: { features },
    });
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
      const pgmBytes = gunzipSync(gzipBytes);
      const actualHash = createHash('sha256').update(pgmBytes).digest('hex');
      if (actualHash !== manifest.sha256) {
        throw new Error(`sha256 mismatch: expected ${manifest.sha256}, got ${actualHash}`);
      }

      const storedMap = await upsertSingleMap(
        fastify,
        robotId,
        {
          name: manifest.name,
          map_yaml: manifest.map_yaml,
          map_pgm: manifest.map_pgm,
          map_yaml_content: manifest.map_yaml_content,
          map_pgm_content: pgmBytes,
          metadata_json: manifest.metadata_json,
        },
        Boolean(manifest.is_default ?? manifest.isDefault ?? true)
      );
      if (!storedMap) {
        throw new Error('Map upsert failed');
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
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ robotId, transferId, err: error }, 'Failed to finalize chunked map transfer');
      sendEvent('MAP_TRANSFER_ERROR', { transferId, message });
      markFailed(message);
    }
  };

  socket.on('open', () => {
    try {
      resetActivityTimeout();
      socket.send(JSON.stringify({ event: 'GET_MAP_DATA', payload: {} }));
      logger.info({ robotId, targetUrl }, 'Sent GET_MAP_DATA via mapping bridge');
    } catch (err) {
      logger.error({ robotId, targetUrl, err }, 'Failed to send GET_MAP_DATA via mapping bridge');
      stop('send-error');
    }
  });

  socket.on('message', async (data, isBinary) => {
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
        const existing = await prisma.map.findUnique({
          where: { filename },
          select: { id: true, contentHash: true },
        });
        const expectedContentHash =
          manifest.contentHash ?? manifest.content_hash ?? manifest.map_content_hash;
        if (
          existing?.contentHash &&
          (existing.contentHash === expectedContentHash || existing.contentHash === rawHash)
        ) {
          const featuresUpdated = await updateExistingMapFeatures(filename, manifest);
          if (manifest.is_default ?? manifest.isDefault ?? true) {
            await linkExistingMapToRobot(filename);
          }
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

      if (parsed?.event === 'MAP_DATA_RESPONSE' && parsed?.payload?.files) {
        logger.info({ robotId, targetUrl }, 'Received MAP_DATA_RESPONSE via mapping bridge');
        updateMapSyncStatus(robotId, {
          phase: 'processing',
          bytesReceived: 0,
          percent: undefined,
          lastError: undefined,
        });
        const storedMap = await upsertMapFromResponse(fastify, robotId, parsed.payload.files);
        updateMapSyncStatus(robotId, {
          phase: 'complete',
          mapId: storedMap?.id,
          percent: 100,
          lastError: undefined,
        });
        stop('map-upserted');
      }
    } catch (err) {
      logger.debug({ robotId, err }, 'Failed to process mapping bridge payload');
      updateMapSyncStatus(robotId, {
        phase: 'failed',
        lastError: err instanceof Error ? err.message : String(err),
      });
    }
  });

  socket.on('error', err => {
    logger.error({ robotId, targetUrl, err }, 'Mapping bridge socket error');
    updateMapSyncStatus(robotId, {
      phase: 'failed',
      lastError: err instanceof Error ? err.message : String(err),
    });
    stop('error');
  });

  socket.on('close', () => {
    if (activityTimeout) clearTimeout(activityTimeout);
  });

  return getMapSyncStatus(robotId);
};
