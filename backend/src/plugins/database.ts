import { type Prisma, PrismaClient } from '@prisma/client';
import fp from 'fastify-plugin';
import type { AppFastifyInstance, AppFastifyReply, AppFastifyRequest } from '../types/app.js';

const databaseUrl = process.env['DATABASE_URL'];

if (!databaseUrl) {
  throw new Error('DATABASE_URL is not configured');
}

/**
 * Database plugin for Fastify
 * Sets up Prisma client with proper configuration
 */
const databasePlugin = async (fastify: AppFastifyInstance) => {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
    errorFormat: 'pretty',
    log: [
      {
        emit: 'event',
        level: 'query',
      },
      {
        emit: 'event',
        level: 'error',
      },
      {
        emit: 'event',
        level: 'info',
      },
      {
        emit: 'event',
        level: 'warn',
      },
    ],
  });

  fastify.decorate('prisma', prisma);

  prisma.$on('query', (event: Prisma.QueryEvent) => {
    if ((process.env['NODE_ENV'] ?? 'development') === 'development') {
      fastify.log.debug(
        {
          query: event.query,
          params: event.params,
          duration: `${event.duration}ms`,
          target: event.target,
        },
        'Database query executed'
      );
    }
  });

  prisma.$on('error', (event: Prisma.LogEvent) => {
    fastify.log.error(
      {
        target: event.target,
        message: event.message,
      },
      'Database error'
    );
  });

  prisma.$on('info', (event: Prisma.LogEvent) => {
    fastify.log.info(
      {
        target: event.target,
        message: event.message,
      },
      'Database info'
    );
  });

  prisma.$on('warn', (event: Prisma.LogEvent) => {
    fastify.log.warn(
      {
        target: event.target,
        message: event.message,
      },
      'Database warning'
    );
  });

  fastify.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

  fastify.get('/health/database', async (_request: AppFastifyRequest, reply: AppFastifyReply) => {
    try {
      await prisma.user.count();

      return {
        status: 'healthy',
        database: 'connected',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      fastify.log.error(error, 'Database health check failed');

      reply.status(503);
      return {
        status: 'unhealthy',
        database: 'disconnected',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      };
    }
  });

  fastify.log.info('Database plugin loaded successfully');
};

export default fp(databasePlugin, {
  name: 'database-plugin',
});
