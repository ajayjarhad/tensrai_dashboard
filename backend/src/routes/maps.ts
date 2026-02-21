import { trace } from '@opentelemetry/api';
import { databaseMetrics, mapMetrics } from '../metrics/index.js';
import type { AppFastifyInstance, AppFastifyReply, AppFastifyRequest } from '../types/app.js';

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
        data: map,
      };
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
