import { trace } from '@opentelemetry/api';
import type { Map as MapRecord, PrismaClient } from '@prisma/client';
import { databaseMetrics, mapMetrics } from '../metrics/index.js';
import { requireActiveSession } from '../middleware/auth.js';
import { isGzipped, pgmOf } from '../services/mapImage.js';
import { canonicalJson, sha256 } from '../services/mapRevision.js';
import { yamlTextOf } from '../services/mapUpload.js';
import { assignmentsInFlight, robotMapOutcome, robotStateFor } from '../services/robotMapJobs.js';
import type { AppFastifyInstance, AppFastifyReply, IdParams } from '../types/app.js';

const sendBinaryAsset = (
  reply: AppFastifyReply,
  asset: Buffer | Uint8Array,
  contentType: string,
  contentHash?: string | null
) => {
  const bytes = Buffer.from(asset);
  if (contentHash) {
    reply.header('ETag', `"${contentHash}"`);
  }
  reply.header('Content-Type', contentType);
  reply.header('Content-Length', String(bytes.length));
  reply.header('Cache-Control', 'private, max-age=31536000, immutable');
  return reply.send(bytes);
};

const displayFieldsForMap = (
  map: Pick<
    MapRecord,
    | 'displayWebpSizeBytes'
    | 'displayPngSizeBytes'
    | 'previewWebp'
    | 'previewPng'
    | 'previewSizeBytes'
    | 'displayGenerationError'
  >
) => ({
  webp: Boolean(map.displayWebpSizeBytes),
  png: Boolean(map.displayPngSizeBytes),
  previewWebp: Boolean(map.previewWebp),
  previewPng: Boolean(map.previewPng),
  displayWebpSizeBytes: map.displayWebpSizeBytes ?? null,
  displayPngSizeBytes: map.displayPngSizeBytes ?? null,
  previewSizeBytes: map.previewSizeBytes ?? null,
  error: map.displayGenerationError ?? null,
});

const hashJson = (value: unknown) => sha256(canonicalJson(value ?? null));

// Each robot holding the map, with its sync state. Links are read with their own scoped query: the
// scoped client does not filter nested includes.
const robotsHolding = async (
  prisma: PrismaClient,
  maps: { id: string; revision: string | null; editedAt: Date | null }[]
) => {
  // In parallel: an org has few robots, so fetching all of them saves a round trip.
  const [links, robots] = await Promise.all([
    prisma.robotMap.findMany({
      where: { mapId: { in: maps.map(map => map.id) } },
      select: {
        robotId: true,
        mapId: true,
        isActive: true,
        filename: true,
        syncedAt: true,
        pushedRevision: true,
        conflictRevision: true,
      },
    }),
    prisma.robot.findMany({ select: { id: true, name: true } }),
  ]);
  const inFlight = new Map(maps.map(map => [map.id, assignmentsInFlight(map.id)]));
  const nameOf = new Map(robots.map(robot => [robot.id, robot.name]));
  return (mapId: string) => {
    const map = maps.find(candidate => candidate.id === mapId);
    const held = links
      .filter(link => link.mapId === mapId && nameOf.has(link.robotId))
      .map(link => ({
        robotId: link.robotId,
        name: nameOf.get(link.robotId) as string,
        isActive: link.isActive,
        filename: link.filename,
        syncedAt: link.syncedAt,
        ...(map ? robotStateFor(link, map) : { state: 'needs_sync' as const }),
        failedAt: robotMapOutcome(link.robotId, mapId)?.at ?? null,
      }));
    // An assignment still on its way, or one the robot refused: not held yet, shown all the same.
    const arriving = (inFlight.get(mapId) ?? [])
      .filter(
        entry => nameOf.has(entry.robotId) && !held.some(robot => robot.robotId === entry.robotId)
      )
      .map(entry => ({
        ...entry,
        name: nameOf.get(entry.robotId) as string,
        isActive: false,
        filename: null,
        syncedAt: null,
        assigning: true,
        failedAt: robotMapOutcome(entry.robotId, mapId)?.at ?? null,
      }));
    return [...held, ...arriving];
  };
};

type MapAssetParams = { Params: { id: string; format: 'webp' | 'png' } };

const idParamsSchema = {
  params: {
    type: 'object',
    properties: {
      id: { type: 'string' },
    },
    required: ['id'],
  },
};

const ASSET_COLUMNS = {
  display: { webp: 'displayWebp', png: 'displayPng' },
  preview: { webp: 'previewWebp', png: 'previewPng' },
} as const;

const mapRoutes = async (server: AppFastifyInstance) => {
  server.addHook('onRequest', requireActiveSession);

  // GET /api/maps - list maps (id + name)
  server.get('/maps', async request => {
    const tracer = trace.getTracer('map-routes');
    const span = tracer.startSpan('maps.list');
    const startTime = Date.now();

    try {
      const prisma = request.db;
      const maps = await prisma.map.findMany({
        select: {
          id: true,
          name: true,
          filename: true,
          editedAt: true,
          editedBy: true,
          revision: true,
          metadata: true,
          contentHash: true,
          pixelWidth: true,
          pixelHeight: true,
          imageSizeBytes: true,
          displayWebpSizeBytes: true,
          displayPngSizeBytes: true,
          previewSizeBytes: true,
          displayGenerationError: true,
        },
        orderBy: { name: 'asc' },
      });

      // Record database metrics
      databaseMetrics.queryDuration.record(Date.now() - startTime, {
        'db.operation': 'findMany',
        'db.collection': 'maps',
      });

      databaseMetrics.operationCount.add(1, {
        'db.operation': 'findMany',
        'db.collection': 'maps',
      });

      span.setAttributes({
        'maps.count': maps.length,
        'db.query.duration_ms': Date.now() - startTime,
      });
      span.end();

      const robotsFor = await robotsHolding(prisma, maps);
      return {
        success: true,
        data: maps.map(map => ({ ...map, robots: robotsFor(map.id) })),
      };
    } catch (error) {
      databaseMetrics.queryDuration.record(Date.now() - startTime, {
        'db.operation': 'findMany',
        'db.collection': 'maps',
        'db.error': 'true',
      });

      span.recordException(error as Error);
      span.end();
      throw error;
    }
  });

  // GET /api/maps/:id - Get map metadata and features
  server.get<IdParams>('/maps/:id', { schema: idParamsSchema }, async (request, reply) => {
    const { id } = request.params;
    const prisma = request.db;

    const map = await prisma.map.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        filename: true,
        editedAt: true,
        editedBy: true,
        revision: true,
        metadata: true,
        features: true,
        contentHash: true,
        pixelWidth: true,
        pixelHeight: true,
        imageSizeBytes: true,
        displayWebpSizeBytes: true,
        displayPngSizeBytes: true,
        previewWebp: true,
        previewPng: true,
        previewSizeBytes: true,
        displayGenerationError: true,
        // Exclude image for performance
      },
    });

    if (!map) {
      return reply.status(404).send({
        success: false,
        error: 'Map not found',
      });
    }

    const robotsFor = await robotsHolding(prisma, [map]);
    return {
      success: true,
      data: {
        ...map,
        yamlText: yamlTextOf(map.metadata),
        robots: robotsFor(map.id),
        featuresHash: hashJson(map.features),
        displayAssets: displayFieldsForMap(map),
        previewWebp: undefined,
        previewPng: undefined,
      },
    };
  });

  for (const kind of ['display', 'preview'] as const) {
    server.get<MapAssetParams>(
      `/maps/:id/${kind}/:format`,
      {
        schema: {
          params: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              format: { type: 'string', enum: ['webp', 'png'] },
            },
            required: ['id', 'format'],
          },
        },
      },
      async (request, reply) => {
        const { id, format } = request.params;
        const column = ASSET_COLUMNS[kind][format];
        // Prisma can't type a select chosen at runtime; the column is one of the four above.
        const map = (await request.db.map.findUnique({
          where: { id },
          select: { [column]: true, contentHash: true },
        })) as Pick<MapRecord, typeof column | 'contentHash'> | null;

        const asset = map?.[column];
        if (!asset) {
          return reply.status(404).send({
            success: false,
            error: `Map ${format.toUpperCase()} ${kind} asset not found`,
          });
        }

        return sendBinaryAsset(
          reply,
          asset,
          format === 'webp' ? 'image/webp' : 'image/png',
          map.contentHash
        );
      }
    );
  }

  // GET /api/maps/:id/image - Get map PGM image
  server.get<IdParams>('/maps/:id/image', { schema: idParamsSchema }, async (request, reply) => {
    const { id } = request.params;
    const tracer = trace.getTracer('map-routes');
    const span = tracer.startSpan('maps.image.download', {
      attributes: {
        'map.id': id,
      },
    });
    const startTime = Date.now();

    try {
      const prisma = request.db;

      const map = await prisma.map.findUnique({
        where: { id },
        select: {
          image: true,
          contentHash: true,
        },
      });

      if (!map) {
        span.setAttributes({
          'map.download.success': false,
          'map.download.reason': 'not_found',
        });
        span.end();
        return reply.status(404).send('Map not found');
      }

      // Record download metrics
      mapMetrics.downloadCount.add(1, {
        'map.id': id,
      });

      // Record database metrics
      databaseMetrics.queryDuration.record(Date.now() - startTime, {
        'db.operation': 'findUnique',
        'db.collection': 'maps',
      });

      databaseMetrics.operationCount.add(1, {
        'db.operation': 'findUnique',
        'db.collection': 'maps',
      });

      span.setAttributes({
        'map.download.success': true,
        'map.image.size_bytes': map.image.length,
        'db.query.duration_ms': Date.now() - startTime,
      });
      span.end();

      // Stored gzipped (services/mapImage.ts): sent as it is to clients that take gzip, which every
      // browser does, and unpacked for the rest.
      const asGzip =
        isGzipped(map.image) && /\bgzip\b/.test(String(request.headers['accept-encoding'] ?? ''));
      const body = asGzip ? Buffer.from(map.image) : pgmOf(map.image);
      reply.header('Content-Type', 'image/x-portable-graymap');
      reply.header('Vary', 'Accept-Encoding');
      if (asGzip) reply.header('Content-Encoding', 'gzip');
      reply.header('Content-Length', String(body.length));
      if (map.contentHash) {
        reply.header('ETag', `"${map.contentHash}${asGzip ? '-gzip' : ''}"`);
      }
      reply.header('Cache-Control', 'private, max-age=31536000, immutable');
      return reply.send(body);
    } catch (error) {
      databaseMetrics.queryDuration.record(Date.now() - startTime, {
        'db.operation': 'findUnique',
        'db.collection': 'maps',
        'db.error': 'true',
      });

      span.setAttributes({
        'map.download.success': false,
        'map.download.reason': 'database_error',
      });

      span.recordException(error as Error);
      span.end();
      throw error;
    }
  });
};

export default mapRoutes;
