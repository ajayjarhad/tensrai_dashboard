// Initialize OpenTelemetry BEFORE importing anything else
import './otel';

import fastify from 'fastify';
import authPlugin from './plugins/auth.js';
import databasePlugin from './plugins/database.js';
import observabilityPlugin from './plugins/observability.js';
import securityPlugin from './plugins/security.js';
import mapRoutes from './routes/maps.js';
import missionRunRoutes from './routes/missionRuns.js';
import robotRoutes from './routes/robots.js';
import rosGateway from './routes/rosGateway.js';
import userRoutes from './routes/users.js';
import { EmergencyRegistry } from './services/emergencyRegistry.js';
import { MissionRegistry } from './services/missionRegistry.js';
import type { AppFastifyInstance, AppFastifyReply, AppFastifyRequest } from './types/app.js';

type FastifyFactory = (options?: Record<string, unknown>) => AppFastifyInstance;

const createFastify = fastify as unknown as FastifyFactory;

const server = createFastify({
  disableRequestLogging: true,
  logger: {
    level: process.env['LOG_LEVEL'] ?? 'warn',
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

const NOISE_PATTERNS = [/ROSLib uses utf8 encoding by default/];
const isNoise = (chunk: any) => {
  const text =
    typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : '';
  return text.length > 0 && NOISE_PATTERNS.some(p => p.test(text));
};
const stderrWrite = process.stderr.write.bind(process.stderr);
const stdoutWrite = process.stdout.write.bind(process.stdout);
process.stderr.write = ((chunk: any, ...rest: any[]) =>
  isNoise(chunk) ? true : stderrWrite(chunk, ...rest)) as typeof process.stderr.write;
process.stdout.write = ((chunk: any, ...rest: any[]) =>
  isNoise(chunk) ? true : stdoutWrite(chunk, ...rest)) as typeof process.stdout.write;
const wrapConsole =
  (orig: (...args: any[]) => void) =>
  (...args: any[]) => {
    if (args.some(a => isNoise(a))) return;
    orig(...args);
  };
console.log = wrapConsole(console.log.bind(console));
console.warn = wrapConsole(console.warn.bind(console));
console.error = wrapConsole(console.error.bind(console));
console.info = wrapConsole(console.info.bind(console));

const registerPlugins = async () => {
  await server.register(databasePlugin);
  const emergencyRegistry = new EmergencyRegistry(server.prisma, server.log);
  server.decorate('emergencyRegistry', emergencyRegistry);
  const missionRegistry = new MissionRegistry(server.prisma, server.log, {
    rememberNonEmergencyStatus:
      emergencyRegistry.rememberNonEmergencyStatus.bind(emergencyRegistry),
  });
  server.decorate('missionRegistry', missionRegistry);
  await emergencyRegistry.reloadFromDb().catch(error => {
    server.log.error({ error }, 'Failed to load emergency registry from DB');
  });
  await missionRegistry.reloadFromDb().catch(error => {
    server.log.error({ error }, 'Failed to load mission registry from DB');
  });
  server.addHook('onClose', async () => {
    emergencyRegistry.stop();
    missionRegistry.stop();
  });
  await server.register(observabilityPlugin);
  await server.register(securityPlugin);
  await server.register(authPlugin);
  await server.register(rosGateway);

  await server.register(userRoutes, { prefix: '/api' });
  await server.register(robotRoutes, { prefix: '/api' });
  await server.register(missionRunRoutes, { prefix: '/api' });
  await server.register(mapRoutes, { prefix: '/api' });

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
