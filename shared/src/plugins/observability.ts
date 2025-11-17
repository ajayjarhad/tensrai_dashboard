import type { FastifyPluginAsync } from 'fastify';

/**
 * Observability plugin for Fastify
 * Basic logging and monitoring setup
 * Note: SigNoz/OpenTelemetry integration ready but not actively configured
 */
const observabilityPlugin: FastifyPluginAsync = async fastify => {
  fastify.addHook('onRequest', async request => {
    request.startTime = Date.now();
  });

  fastify.addHook('onResponse', async (request, reply) => {
    const startTime = request.startTime;
    const duration = startTime ? Date.now() - startTime : 0;

    fastify.log.info(
      {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        duration: `${duration}ms`,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      },
      'HTTP Request completed'
    );
  });

  fastify.addHook('onError', async (request, reply, error) => {
    fastify.log.error(
      {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        error: error.message,
        stack: error.stack,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      },
      'Request error'
    );
  });

  fastify.get('/health/observability', async () => ({
    status: 'healthy',
    observability: {
      logging: 'enabled',
      metrics: 'basic',
      tracing: 'ready-for-signoz',
    },
    timestamp: new Date().toISOString(),
  }));

  fastify.log.info('Observability plugin loaded successfully');
};

declare module 'fastify' {
  export interface FastifyRequest {
    startTime?: number;
  }
}

export default observabilityPlugin;
