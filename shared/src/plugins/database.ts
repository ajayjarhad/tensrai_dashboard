import { PrismaClient } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

const databasePlugin: FastifyPluginAsync = async fastify => {
  const databaseUrl = process.env['DATABASE_URL'] ?? 'mongodb://localhost:27017/tensrai_dashboard';
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
    errorFormat: 'pretty',
  });

  fastify.decorate('prisma', prisma);

  fastify.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

  fastify.get('/health/database', async () => {
    try {
      await prisma.user.count();

      return {
        status: 'healthy',
        database: 'connected',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      fastify.log.error(error, 'Database health check failed');

      return {
        status: 'unhealthy',
        database: 'disconnected',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      };
    }
  });
};

export default databasePlugin;
