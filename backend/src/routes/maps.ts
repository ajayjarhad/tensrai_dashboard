import { trace } from '@opentelemetry/api';
import { databaseMetrics, mapMetrics } from '../metrics/index.js';
import type { AppFastifyInstance, AppFastifyReply, AppFastifyRequest } from '../types/app.js';

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
  reply.header('Cache-Control', 'public, max-age=31536000, immutable');
  return reply.send(bytes);
};

const displayFieldsForMap = (map: any) => ({
  webp: Boolean(map.displayWebpSizeBytes),
  png: Boolean(map.displayPngSizeBytes),
  previewWebp: Boolean(map.previewWebp),
  previewPng: Boolean(map.previewPng),
  displayWebpSizeBytes: map.displayWebpSizeBytes ?? null,
  displayPngSizeBytes: map.displayPngSizeBytes ?? null,
  previewSizeBytes: map.previewSizeBytes ?? null,
  error: map.displayGenerationError ?? null,
});

const mapRoutes: any = async (server: AppFastifyInstance) => {
  // GET /api/maps - list maps (id + name)
  server.get('/maps', async (_request: AppFastifyRequest) => {
    const tracer = trace.getTracer('map-routes');
    const span = tracer.startSpan('maps.list');
    const startTime = Date.now();

    try {
      const prisma = server.prisma as any;
      const maps = await prisma.map.findMany({
        select: {
          id: true,
          name: true,
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

      return {
        success: true,
        data: maps,
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
  server.get(
    '/maps/:id',
    {
      schema: {
        params: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
          required: ['id'],
        },
      },
    },
    async (request: AppFastifyRequest, reply: AppFastifyReply) => {
      const { id } = request.params as { id: string };
      const prisma = server.prisma as any;

      const map = await prisma.map.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
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

      return {
        success: true,
        data: {
          ...map,
          displayAssets: displayFieldsForMap(map),
          previewWebp: undefined,
          previewPng: undefined,
        },
      };
    }
  );

  server.get(
    '/maps/:id/display/:format',
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
    async (request: AppFastifyRequest, reply: AppFastifyReply) => {
      const { id, format } = request.params as { id: string; format: 'webp' | 'png' };
      const prisma = server.prisma as any;
      const map = await prisma.map.findUnique({
        where: { id },
        select:
          format === 'webp'
            ? { displayWebp: true, contentHash: true }
            : { displayPng: true, contentHash: true },
      });

      const asset = format === 'webp' ? map?.displayWebp : map?.displayPng;
      if (!asset) {
        return reply.status(404).send({
          success: false,
          error: `Map ${format.toUpperCase()} display asset not found`,
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

  server.get(
    '/maps/:id/preview/:format',
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
    async (request: AppFastifyRequest, reply: AppFastifyReply) => {
      const { id, format } = request.params as { id: string; format: 'webp' | 'png' };
      const prisma = server.prisma as any;
      const map = await prisma.map.findUnique({
        where: { id },
        select:
          format === 'webp'
            ? { previewWebp: true, contentHash: true }
            : { previewPng: true, contentHash: true },
      });

      const asset = format === 'webp' ? map?.previewWebp : map?.previewPng;
      if (!asset) {
        return reply.status(404).send({
          success: false,
          error: `Map ${format.toUpperCase()} preview asset not found`,
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

  // GET /api/maps/:id/image - Get map PGM image
  server.get(
    '/maps/:id/image',
    {
      schema: {
        params: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
          required: ['id'],
        },
      },
    },
    async (request: AppFastifyRequest, reply: AppFastifyReply) => {
      const { id } = request.params as { id: string };
      const tracer = trace.getTracer('map-routes');
      const span = tracer.startSpan('maps.image.download', {
        attributes: {
          'map.id': id,
        },
      });
      const startTime = Date.now();

      try {
        const prisma = server.prisma as any;

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
          'map.image.size_bytes': map.image ? map.image.length : 0,
          'db.query.duration_ms': Date.now() - startTime,
        });
        span.end();

        reply.header('Content-Type', 'image/x-portable-graymap');
        reply.header('Content-Length', String(map.image ? map.image.length : 0));
        if (map.contentHash) {
          reply.header('ETag', `"${map.contentHash}"`);
        }
        reply.header('Cache-Control', 'public, max-age=31536000, immutable');
        return reply.send(map.image);
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
    }
  );
};

export default mapRoutes;
