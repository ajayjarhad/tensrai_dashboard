import { DiagConsoleLogger, DiagLogLevel, diag } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';

let sdk: NodeSDK | null = null;

export const initializeOpenTelemetry = (): NodeSDK => {
  if (sdk) {
    return sdk;
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

  const otlpEndpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] || 'http://localhost:4318';

  // Ensure endpoint has the full URL for HTTP exporter
  const httpEndpoint = otlpEndpoint.startsWith('http') ? otlpEndpoint : `http://${otlpEndpoint}`;

  const traceExporter = new OTLPTraceExporter({
    url: `${httpEndpoint}/v1/traces`,
  });

  sdk = new NodeSDK({
    serviceName,
    traceExporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': {
          enabled: false,
        },
      }),
    ],
  });

  try {
    sdk.start();
    console.log('🔍 OpenTelemetry initialized');
    console.log(`   Service: ${serviceName} v${serviceVersion}`);
    console.log(`   Exporter: ${httpEndpoint}`);
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
