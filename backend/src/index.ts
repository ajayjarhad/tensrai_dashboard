import fastify from 'fastify';
import authPlugin from './plugins/auth.js';
import databasePlugin from './plugins/database.js';
import observabilityPlugin from './plugins/observability.js';
import securityPlugin from './plugins/security.js';
import userRoutes from './routes/users.js';
import type { AppFastifyInstance, AppFastifyReply, AppFastifyRequest } from './types/app.js';

type FastifyFactory = (options?: Record<string, unknown>) => AppFastifyInstance;

const createFastify = fastify as unknown as FastifyFactory;

const server = createFastify({
  logger: {
    level: process.env['LOG_LEVEL'] ?? 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    },
  },
});

const registerPlugins = async () => {
  await server.register(databasePlugin);
  await server.register(observabilityPlugin);
  await server.register(securityPlugin);
  await server.register(authPlugin);

  await server.register(userRoutes, { prefix: '/api' });

  server.log.info('All plugins and routes registered successfully');
};

server.get('/', async () => {
  return {
    message: 'Tensrai Dashboard API',
    version: '1.0.0',
    status: 'running',
    timestamp: new Date().toISOString(),
  };
});

server.get('/health', async () => ({
  status: 'healthy',
  service: 'Tensrai Dashboard API',
  version: '1.0.0',
  timestamp: new Date().toISOString(),
  environment: process.env['NODE_ENV'] ?? 'development',
}));

server.get('/api', async () => ({
  service: 'Tensrai Dashboard API',
  version: '1.0.0',
  endpoints: {
    auth: '/api/auth/*',
    users: '/api/users/*',
    health: {
      general: '/health',
      database: '/health/database',
      security: '/health/security',
      observability: '/health/observability',
    },
  },
  features: {
    authentication: 'enabled',
    userManagement: 'enabled',
    rbac: 'active',
    auditLogging: 'enabled',
    observability: 'basic-enabled',
  },
}));

server.setErrorHandler((error: Error, request: AppFastifyRequest, reply: AppFastifyReply) => {
  server.log.error(
    {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      url: request.url,
      method: request.method,
    },
    'Unhandled error'
  );

  reply.status(500).send({
    success: false,
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
    timestamp: new Date().toISOString(),
  });
});

server.setNotFoundHandler((request: AppFastifyRequest, reply: AppFastifyReply) => {
  reply.status(404).send({
    success: false,
    error: 'Route not found',
    code: 'NOT_FOUND',
    path: request.url,
    method: request.method,
    timestamp: new Date().toISOString(),
  });
});

const start = async () => {
  try {
    await registerPlugins();

    const port = Number(process.env['PORT'] ?? 5001);
    const host = process.env['HOST'] ?? '0.0.0.0';

    await server.listen({ port, host });

    server.log.info({
      port,
      host,
      environment: process.env['NODE_ENV'] ?? 'development',
      message: 'Tensrai Dashboard API started successfully',
    });

    console.log(`🚀 Tensrai Dashboard API listening on http://${host}:${port}`);
    console.log(`📊 Health check: http://${host}:${port}/health`);
    console.log(`📚 API docs: http://${host}:${port}/api`);
    console.log(`🔐 Auth endpoints: http://${host}:${port}/api/auth/*`);
  } catch (err) {
    server.log.error(err, 'Failed to start server');
    process.exit(1);
  }
};

process.on('SIGINT', async () => {
  server.log.info('SIGINT received, shutting down gracefully');
  await server.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  server.log.info('SIGTERM received, shutting down gracefully');
  await server.close();
  process.exit(0);
});

start();
