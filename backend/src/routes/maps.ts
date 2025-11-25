// import type { FastifyPluginAsync } from 'fastify';
import type { AppFastifyInstance, AppFastifyReply, AppFastifyRequest } from '../types/app.js';

const mapRoutes: any = async (server: AppFastifyInstance) => {
  // GET /api/maps - list maps (id + name)
  server.get('/maps', async (_request: AppFastifyRequest) => {
    const prisma = server.prisma as any;
    const maps = await prisma.map.findMany({
      select: {
        id: true,
        name: true,
      },
      orderBy: { name: 'asc' },
    });

    return {
      success: true,
      data: maps,
    };
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
      const prisma = server.prisma as any;

      const map = await prisma.map.findUnique({
        where: { id },
        select: {
          image: true,
        },
      });

      if (!map) {
        return reply.status(404).send('Map not found');
      }

      reply.header('Content-Type', 'image/x-portable-graymap');
      reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      return reply.send(map.image);
    }
  );
};

export default mapRoutes;
