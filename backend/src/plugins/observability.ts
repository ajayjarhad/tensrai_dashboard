import { context, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import fp from 'fastify-plugin';
import { apiMetrics } from '../metrics/index.js';
import type { AppFastifyInstance, AppFastifyReply, AppFastifyRequest } from '../types/app.js';
import {
  isBunRuntime,
  isMetricsEnabled,
  isTracingEnabled,
  otlpUrl,
} from '../utils/telemetryConfig.js';

const tracer = trace.getTracer('http');

const observabilityPlugin = async (fastify: AppFastifyInstance) => {
  fastify.decorateRequest('requestSpan', null);

  fastify.addHook('onRequest', (request: AppFastifyRequest, _reply, done) => {
    request.startTime = Date.now();
    // Bun's HTTP server can't be auto-instrumented, so each request opens its own server span and
    // makes it the active context, which nests the routes' own spans inside it. Under Node the http
    // instrumentation does this, and sockets have a span of their own.
    if (!isBunRuntime || request.headers.upgrade) return done();
    const route = request.routeOptions.url ?? 'unmatched route';
    const span = tracer.startSpan(`${request.method} ${route}`, {
      kind: SpanKind.SERVER,
      attributes: {
        'http.method': request.method,
        'http.route': route,
        'http.target': request.url.split('?')[0] ?? request.url,
      },
    });
    request.requestSpan = span;
    context.with(trace.setSpan(context.active(), span), done);
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
    const span = request.requestSpan;
    if (span) {
      span.setAttribute('http.status_code', reply.statusCode);
      if (reply.statusCode >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
    }

    if (reply.statusCode >= 400) {
      apiMetrics.errorRate.add(1, {
        'http.method': request.method,
        'http.route': routePath,
        'error.type': reply.statusCode >= 500 ? 'server_error' : 'client_error',
        'http.status_code': reply.statusCode.toString(),
      });
    }

    fastify.log.debug(
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
      const span = request.requestSpan ?? trace.getActiveSpan();

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
      logLevel: fastify.log.level,
      tracing: { enabled: isTracingEnabled(), exporter: 'otlp-http', endpoint: otlpUrl('traces') },
      metrics: { enabled: isMetricsEnabled(), exporter: 'otlp-http', endpoint: otlpUrl('metrics') },
      service: process.env['OTEL_SERVICE_NAME'] || 'tensrai-backend',
      timestamp: new Date().toISOString(),
    },
  }));
};

// Without fastify-plugin its hooks would only see its own route, so no other request was measured.
export default fp(observabilityPlugin, { name: 'observability' });
