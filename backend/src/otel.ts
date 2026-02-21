import { DiagConsoleLogger, DiagLogLevel, diag } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';

let sdk: NodeSDK | null = null;

export const initializeOpenTelemetry = (): NodeSDK => {
  if (sdk) {
    return sdk;
  }

  const isBunRuntime =
    typeof (globalThis as any).Bun !== 'undefined' || typeof process.versions?.['bun'] === 'string';
  const otelEnabledEnv = process.env['OTEL_ENABLED'];
  const otelEnabled =
    otelEnabledEnv !== undefined
      ? otelEnabledEnv !== 'false'
      : (process.env['NODE_ENV'] ?? 'development') === 'production' || !isBunRuntime;

  if (!otelEnabled) {
    console.log('OpenTelemetry disabled (set OTEL_ENABLED=true to enable)');
    return (sdk as unknown as NodeSDK) ?? ({} as NodeSDK);
  }

  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);

  const serviceName = process.env['OTEL_SERVICE_NAME'] || 'tensrai-backend';
  const serviceVersion = process.env['npm_package_version'] || '1.0.0';
  const instanceId = process.env['OTEL_SERVICE_INSTANCE_ID'] || process.env['HOSTNAME'] || 'local';
  const environment = process.env['NODE_ENV'] || 'development';

  const resourceAttributes = [
    `deployment.environment=${environment}`,
    `service.instance.id=${instanceId}`,
    'application=tensrai-dashboard',
  ].join(',');

  const existingAttributes = process.env['OTEL_RESOURCE_ATTRIBUTES'];
  process.env['OTEL_RESOURCE_ATTRIBUTES'] = existingAttributes
    ? `${existingAttributes},${resourceAttributes}`
    : resourceAttributes;

  // OTLP/HTTP exporter expects /v1/traces; avoid double-appending the path
  const rawEndpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] || 'http://otel-collector:4318';
  const normalizedEndpoint = rawEndpoint.startsWith('http') ? rawEndpoint : `http://${rawEndpoint}`;
  const traceUrl = normalizedEndpoint.endsWith('/v1/traces')
    ? normalizedEndpoint
    : `${normalizedEndpoint.replace(/\/+$/, '')}/v1/traces`;

  const traceExporter = new OTLPTraceExporter({
    url: traceUrl,
  }) as any;

  sdk = new NodeSDK({
    serviceName,
    traceExporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': {
          enabled: false,
        },
        '@opentelemetry/instrumentation-runtime-node': {
          enabled: false,
        },
      }),
    ],
  });

  try {
    sdk.start();

    console.log('🔍 OpenTelemetry initialized');
    console.log(`   Service: ${serviceName} v${serviceVersion}`);
    console.log(`   Traces Exporter: ${traceUrl}`);
  } catch (error) {
    console.error('Failed to start OpenTelemetry SDK', error);
  }

  const shutdown = async () => {
    if (!sdk) return;
    try {
      await sdk.shutdown();
      console.log('OpenTelemetry terminated');
    } catch (error) {
      console.error('Error terminating OpenTelemetry', error);
    } finally {
      sdk = null;
    }
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return sdk;
};

initializeOpenTelemetry();
