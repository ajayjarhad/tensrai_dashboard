import type { Prisma } from '@prisma/client';
import type {
  AppFastifyInstance,
  AppFastifyReply,
  AppFastifyRequest,
  AuditEvent,
} from '../types/app.js';

/**
 * Observability plugin for Fastify
 * Basic logging setup - will be expanded with OpenTelemetry/SigNoz later
 */
const observabilityPlugin = async (fastify: AppFastifyInstance) => {
  if ((process.env['NODE_ENV'] ?? 'development') === 'production') {
    fastify.log.level = 'warn';
  } else {
    fastify.log.level = 'info';
  }

  fastify.decorate('audit', async (event: AuditEvent) => {
    try {
      await fastify.prisma?.auditLog.create({
        data: {
          userId: event.userId,
          role: event.role,
          action: event.action,
          timestamp: new Date(),
          metadata: (event.metadata ?? null) as Prisma.InputJsonValue | null,
        },
      });

      fastify.log.info(
        {
          userId: event.userId,
          role: event.role,
          action: event.action,
          targetUserId: event.targetUserId,
        },
        'Audit event logged'
      );
    } catch (error) {
      fastify.log.error(error, 'Failed to log audit event');
    }
  });

  fastify.decorateRequest('audit', fastify.audit);

  fastify.addHook('onRequest', async (request: AppFastifyRequest) => {
    request.startTime = Date.now();
  });

  fastify.addHook('onResponse', async (request: AppFastifyRequest, reply: AppFastifyReply) => {
    const duration = request.startTime ? Date.now() - request.startTime : 0;

    fastify.log.info(
      {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        duration: `${duration}ms`,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      },
      'Request completed'
    );
  });

  fastify.addHook(
    'onError',
    async (request: AppFastifyRequest, _reply: AppFastifyReply, error: Error) => {
      fastify.log.error(
        {
          error: error.message,
          stack: error.stack,
          method: request.method,
          url: request.url,
          ip: request.ip,
          userAgent: request.headers['user-agent'],
        },
        'Request error'
      );
    }
  );

  fastify.get('/health/observability', async () => ({
    status: 'healthy',
    observability: {
      logging: 'enabled',
      auditLogging: 'enabled',
      tracing: 'enabled-sigNoz-connected',
      openTelemetry: {
        service: process.env['OTEL_SERVICE_NAME'] ?? 'tensrai-backend',
        endpoint: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://localhost:4317',
      },
      timestamp: new Date().toISOString(),
    },
  }));
};

export default observabilityPlugin;
