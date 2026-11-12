import { createHash } from 'node:crypto';
import WebSocket from 'ws';
import {
  designateActiveAfterSync,
  findLinkedMapId,
  findMapByContent,
  linkMapToRobot,
  orgIdOfRobot,
  upsertMapFromResponse,
  upsertSingleMap,
} from './mapRecords.js';
import {
  getFeaturePayload,
  gunzipMapImage,
  hasFeaturePayload,
  MapSyncFailure,
  normalizeFeatures,
  UNREADABLE_MAP_FILES,
} from './mapSyncPayload.js';
import {
  clearMapSyncStatus,
  getMapSyncStatus,
  isMapSyncActive,
  peekMapSyncStatus,
  updateMapSyncStatus,
} from './mapSyncStatus.js';
import { isAddressApproved } from './robotAddress.js';

const MAP_TRANSFER_ACTIVITY_TIMEOUT_MS = 45_000;
const DEFAULT_MAP_SYNC_CONNECT_TIMEOUT_MS = 15_000;

const MAP_SYNC_FAILED = 'Map sync failed. Try again.';
const BRIDGE_CONNECTION_FAILED = "Connection to the robot's mapping bridge failed";

const resolveMapSyncConnectTimeoutMs = (fastify: any) => {
  const configured = Number(
    fastify?.mapSyncConnectTimeoutMs ?? process.env['MAP_SYNC_CONNECT_TIMEOUT_MS']
  );
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_MAP_SYNC_CONNECT_TIMEOUT_MS;
};

// A robot decides what it sends, and any organization can point a robot at its own server. These
// bound what one transfer can make this process hold, since every customer shares it.
const MAX_MAP_TRANSFER_BYTES = 64 * 1024 * 1024;
const MAX_MAP_IMAGE_BYTES = 256 * 1024 * 1024;

// JSON.parse's untyped result: bridge firmwares name fields differently, so each read has fallbacks.
type BridgeJson = ReturnType<typeof JSON.parse>;

type ChunkedTransfer = {
  manifest: BridgeJson;
  chunks: Buffer[];
  receivedChunks: Set<number>;
  bytesReceived: number;
};

const frameText = (data: WebSocket.RawData, isBinary: boolean) =>
  !isBinary && typeof data === 'string'
    ? data
    : Buffer.isBuffer(data)
      ? data.toString('utf8')
      : data;

const manifestFields = (manifest: BridgeJson) => ({
  transferId: String(manifest.transferId ?? manifest.transfer_id ?? manifest.sha256),
  filename: String(manifest.map_yaml ?? 'map.yaml'),
  totalChunks: Number(manifest.total_chunks ?? manifest.totalChunks),
  rawHash: manifest.sha256,
  expectedContentHash: manifest.contentHash ?? manifest.content_hash ?? manifest.map_content_hash,
});

const transferIdOf = (payload: BridgeJson) => String(payload.transferId ?? payload.transfer_id);

const isInvalidChunkIndex = (chunkIndex: number, totalChunks: number) =>
  !Number.isInteger(chunkIndex) ||
  chunkIndex < 0 ||
  !Number.isInteger(totalChunks) ||
  chunkIndex >= totalChunks;

const bridgeErrorMessage = (payload: BridgeJson) =>
  String(payload?.error ?? payload?.message ?? 'No map data');

const syncFailureMessage = (error: unknown) =>
  error instanceof MapSyncFailure ? error.message : MAP_SYNC_FAILED;

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

  const currentStatus = peekMapSyncStatus(robotId);
  if (isMapSyncActive(currentStatus)) {
    logger.info(
      { robotId, phase: currentStatus?.phase },
      'Map sync already active; reusing status'
    );
    return getMapSyncStatus(robotId);
  }

  const targetUrl = `ws://${robot.ipAddress}:${robot.mappingBridgePort}`;
  logger.info({ robotId, targetUrl }, 'Connecting to mapping bridge to fetch map');

  clearMapSyncStatus(robotId);
  updateMapSyncStatus(robotId, {
    phase: 'connecting',
    bytesReceived: 0,
    percent: 0,
    lastError: undefined,
  });

  const socket = new WebSocket(targetUrl);
  const connectTimeout = setTimeout(() => {
    const current = peekMapSyncStatus(robotId);
    if (current?.phase === 'connecting') {
      markFailed('map-sync-connect-timeout');
    }
  }, resolveMapSyncConnectTimeoutMs(fastify));
  const transfers = new Map<string, ChunkedTransfer>();
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
      const current = peekMapSyncStatus(robotId);
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

  const storeChunkedMap = async (transferId: string, transfer: ChunkedTransfer) => {
    const { manifest } = transfer;
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
      await storeChunkedMap(transferId, transfer);
    } catch (error) {
      const message = syncFailureMessage(error);
      logger.error({ robotId, transferId, err: error }, 'Failed to finalize chunked map transfer');
      sendEvent('MAP_TRANSFER_ERROR', { transferId, message });
      markFailed(message);
    }
  };

  const handleManifest = async (manifest: BridgeJson) => {
    const { transferId, filename, totalChunks, rawHash, expectedContentHash } =
      manifestFields(manifest);
    if (!rawHash || !Number.isInteger(totalChunks) || totalChunks <= 0) {
      sendEvent('MAP_TRANSFER_ERROR', {
        transferId,
        message: 'invalid map transfer manifest',
      });
      markFailed('invalid map transfer manifest');
      return;
    }
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
  };

  // False when the chunk would take the transfer over its size limit, which fails the sync.
  const storeChunk = (
    transferId: string,
    transfer: ChunkedTransfer,
    chunkIndex: number,
    data: unknown
  ) => {
    if (transfer.receivedChunks.has(chunkIndex)) return true;
    const chunk = Buffer.from(String(data ?? ''), 'base64');
    if (transfer.bytesReceived + chunk.length > MAX_MAP_TRANSFER_BYTES) {
      sendEvent('MAP_TRANSFER_ERROR', { transferId, message: 'map transfer too large' });
      markFailed('map-transfer-too-large');
      return false;
    }
    transfer.chunks[chunkIndex] = chunk;
    transfer.receivedChunks.add(chunkIndex);
    transfer.bytesReceived += chunk.length;
    return true;
  };

  const reportReceiving = (transfer: ChunkedTransfer) => {
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
  };

  const handleChunk = (chunkPayload: BridgeJson) => {
    const transferId = transferIdOf(chunkPayload);
    const transfer = transfers.get(transferId);
    if (!transfer) {
      sendEvent('MAP_TRANSFER_ERROR', { transferId, message: 'unknown transfer id' });
      return;
    }
    const chunkIndex = Number(chunkPayload.index ?? chunkPayload.chunk_index);
    const totalChunks = Number(transfer.manifest.total_chunks ?? transfer.manifest.totalChunks);
    if (isInvalidChunkIndex(chunkIndex, totalChunks)) {
      sendEvent('MAP_TRANSFER_ERROR', { transferId, message: 'invalid chunk index' });
      return;
    }
    if (!storeChunk(transferId, transfer, chunkIndex, chunkPayload.data)) return;
    reportReceiving(transfer);
  };

  const handleMapDataResponse = async (payload: BridgeJson) => {
    if (!payload?.files) {
      markFailed(bridgeErrorMessage(payload));
      return;
    }
    logger.info({ robotId, targetUrl }, 'Received MAP_DATA_RESPONSE via mapping bridge');
    updateMapSyncStatus(robotId, {
      phase: 'processing',
      bytesReceived: 0,
      percent: undefined,
      lastError: undefined,
    });
    const storedMap = await upsertMapFromResponse(fastify, robotId, payload.files);
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
  };

  const handleBridgeFrame = async (parsed: BridgeJson) => {
    switch (parsed?.event) {
      case 'MAP_MANIFEST':
        if (parsed.payload) await handleManifest(parsed.payload);
        return;
      case 'MAP_CHUNK':
        if (parsed.payload) handleChunk(parsed.payload);
        return;
      case 'MAP_TRANSFER_COMPLETE':
        if (parsed.payload) await finalizeChunkedTransfer(transferIdOf(parsed.payload));
        return;
      case 'MAP_BATCH_COMPLETE':
        stop('map-batch-complete');
        return;
      case 'MAP_TRANSFER_ERROR': {
        const message = parsed.payload?.message ?? 'robot reported map transfer error';
        logger.error({ robotId, message }, 'Robot map transfer failed');
        markFailed(message);
        return;
      }
      case 'ERROR':
        markFailed(bridgeErrorMessage(parsed.payload));
        return;
      case 'MAP_DATA_RESPONSE':
        await handleMapDataResponse(parsed.payload);
        return;
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
    const payload = frameText(data, isBinary);

    try {
      const parsed = typeof payload === 'string' ? JSON.parse(payload) : null;
      await handleBridgeFrame(parsed);
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
    if (peekMapSyncStatus(robotId)?.phase !== 'failed') {
      updateMapSyncStatus(robotId, { phase: 'failed', lastError: BRIDGE_CONNECTION_FAILED });
    }
    stop('error');
  });

  socket.on('close', () => {
    clearTimeout(connectTimeout);
    if (activityTimeout) clearTimeout(activityTimeout);
    const current = peekMapSyncStatus(robotId);
    if (isMapSyncActive(current)) {
      updateMapSyncStatus(robotId, {
        phase: 'failed',
        lastError: 'map-sync-connection-closed',
      });
    }
  });

  return getMapSyncStatus(robotId);
};
