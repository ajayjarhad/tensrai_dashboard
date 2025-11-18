import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import type { Resource as ResourceType } from '@opentelemetry/resources';
import * as otelResources from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

type FastifyLoggerLike = {
  log?: {
    info: (...args: unknown[]) => void;
  };
};

let telemetry: NodeSDK | null = null;

/**
 * Initialize OpenTelemetry for the application
 */
export const initializeTelemetry = async (fastify?: FastifyLoggerLike): Promise<NodeSDK> => {
  if (telemetry) {
    return telemetry;
  }

  const exporter = new OTLPTraceExporter({
    url: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://localhost:4317/v1/traces',
  });

  const resource = new (otelResources as any).Resource({
    [SemanticResourceAttributes.SERVICE_NAME]:
      process.env['OTEL_SERVICE_NAME'] ?? 'tensrai-dashboard',
    [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env['NODE_ENV'] ?? 'development',
  }) as ResourceType;

  telemetry = new NodeSDK({
    resource,
    traceExporter: exporter,
    instrumentations: [getNodeAutoInstrumentations()],
  });

  telemetry.start();

  fastify?.log?.info('OpenTelemetry initialized and connected to SigNoz');

  return telemetry;
};

/**
 * Gracefully shutdown OpenTelemetry
 */
export const shutdownTelemetry = async (): Promise<void> => {
  if (telemetry) {
    await telemetry.shutdown();
    telemetry = null;
  }
};

/**
 * Get the current telemetry instance
 */
export const getTelemetry = (): NodeSDK | null => telemetry;
