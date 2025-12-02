// @ts-nocheck
import yaml from 'js-yaml';
import WebSocket from 'ws';

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
    typeof mapPgmRaw === 'string' && (!looksLikeFilename(mapPgmRaw, '.pgm') || isBase64(mapPgmRaw));

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

const getMapDetails = (files: any) => {
  const features = files.metadata_json ?? {};
  const filename = looksLikeFilename(files.map_yaml, '.yaml') ? files.map_yaml : 'map.yaml';
  const name = filename.replace(/\.yaml$/i, '') || filename;
  return { features, filename, name };
};

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

  try {
    const map = await prisma.map.upsert({
      where: { filename },
      update: {
        name,
        image: pgmBytes,
        metadata,
        features,
      },
      create: {
        name,
        filename,
        image: pgmBytes,
        metadata,
        features,
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
  await upsertSingleMap(fastify, robotId, files, true);

  // Process additional maps if provided (not linked to robot)
  if (Array.isArray(files.additional_maps)) {
    for (const extra of files.additional_maps) {
      await upsertSingleMap(fastify, robotId, extra, false);
    }
  }
};

// Connects to the mapping bridge, requests map data, and upserts it.
export const fetchMapViaMappingBridge = async (
  fastify: any,
  robot: { id: string; ipAddress?: string | null; mappingBridgePort?: number | null }
) => {
  const logger = fastify.log;
  const robotId = robot.id;
  if (!robot.ipAddress || !robot.mappingBridgePort) {
    logger.warn({ robotId }, 'Cannot fetch map: mapping bridge not configured');
    return;
  }

  const targetUrl = `ws://${robot.ipAddress}:${robot.mappingBridgePort}`;
  logger.info({ robotId, targetUrl }, 'Connecting to mapping bridge to fetch map');

  const socket = new WebSocket(targetUrl);

  const stop = (reason?: string) => {
    try {
      socket.close();
    } catch {}
    if (reason) logger.info({ robotId, reason }, 'Mapping fetch socket closed');
  };

  const timeout = setTimeout(() => stop('timeout'), 15000);

  socket.on('open', () => {
    try {
      socket.send(JSON.stringify({ event: 'GET_MAP_DATA', payload: {} }));
      logger.info({ robotId, targetUrl }, 'Sent GET_MAP_DATA via mapping bridge');
    } catch (err) {
      logger.error({ robotId, targetUrl, err }, 'Failed to send GET_MAP_DATA via mapping bridge');
      stop('send-error');
    }
  });

  socket.on('message', async (data, isBinary) => {
    const payload =
      !isBinary && typeof data === 'string'
        ? data
        : Buffer.isBuffer(data)
          ? data.toString('utf8')
          : data;

    try {
      const parsed = typeof payload === 'string' ? JSON.parse(payload) : null;
      if (parsed?.event === 'MAP_DATA_RESPONSE' && parsed?.payload?.files) {
        logger.info({ robotId, targetUrl }, 'Received MAP_DATA_RESPONSE via mapping bridge');
        await upsertMapFromResponse(fastify, robotId, parsed.payload.files);
        stop('map-upserted');
      }
    } catch (err) {
      logger.debug({ robotId, err }, 'Failed to parse mapping bridge payload');
    }
  });

  socket.on('error', err => {
    logger.error({ robotId, targetUrl, err }, 'Mapping bridge socket error');
    stop('error');
  });

  socket.on('close', () => {
    clearTimeout(timeout);
  });
};
