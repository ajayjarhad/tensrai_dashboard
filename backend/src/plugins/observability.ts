import { trace } from '@opentelemetry/api';
import type { Prisma } from '@prisma/client';
import { apiMetrics } from '../metrics/index.js';
import type {
  AppFastifyInstance,
  AppFastifyReply,
  AppFastifyRequest,
  AuditEvent,
} from '../types/app.js';

/**
 * Observability plugin for Fastify
 * Enhanced logging with OpenTelemetry/SigNoz integration
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
    const routePath = (request as any).routeOptions?.config?.url ?? request.url;

    // Record API metrics
    apiMetrics.requestDuration.record(duration, {
      'http.method': request.method,
      'http.route': routePath,
      'http.status_code': reply.statusCode.toString(),
    });

    apiMetrics.requestCount.add(1, {
      'http.method': request.method,
      'http.route': routePath,
      'http.status_code': reply.statusCode.toString(),
    });

    // Record errors separately
    if (reply.statusCode >= 400) {
      apiMetrics.errorRate.add(1, {
        'http.method': request.method,
        'http.route': routePath,
        'error.type': reply.statusCode >= 500 ? 'server_error' : 'client_error',
        'http.status_code': reply.statusCode.toString(),
      });
    }

    fastify.log.info(
      {
        method: request.method,
        url: request.url,
        routePath,
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
      const span = trace.getActiveSpan();

      if (span) {
        span.recordException(error);
        span.setAttributes({
          'error.message': error.message,
          'error.type': error.constructor.name,
        });
      }

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
      tracing: 'enabled',
      metrics: {
        enabled: true,
        endpoint: 'http://localhost:9464/metrics',
        exporter: 'prometheus',
      },
      openTelemetry: {
        service: process.env['OTEL_SERVICE_NAME'] ?? 'tensrai-dashboard',
        endpoint: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://localhost:4318',
        exporter: 'otlp-http',
        instrumentation: 'auto',
      },
      sigNoz: {
        dashboard: 'http://localhost:3302',
        collector: 'http://localhost:4318',
      },
      timestamp: new Date().toISOString(),
    },
  }));
};

export default observabilityPlugin;
