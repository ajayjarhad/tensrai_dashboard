import { DiagConsoleLogger, DiagLogLevel, diag } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { NodeSDK } from '@opentelemetry/sdk-node';

type HeaderMap = Record<string, string>;

const parseHeaders = (rawHeaders?: string): HeaderMap | undefined => {
  if (!rawHeaders) return undefined;

  return rawHeaders.split(',').reduce<HeaderMap>((headers, pair) => {
    const [key, value] = pair.split('=').map(part => part?.trim());
    if (key && value) {
      headers[key] = value;
    }
    return headers;
  }, {});
};

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

  const otlpEndpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] || 'http://localhost:4317';
  const otlpHeaders = parseHeaders(process.env['OTEL_EXPORTER_OTLP_HEADERS']);

  const exporterOptions: { url: string; headers?: HeaderMap } = {
    url: otlpEndpoint,
  };

  if (otlpHeaders) {
    exporterOptions.headers = otlpHeaders;
  }

  const traceExporter = new OTLPTraceExporter(exporterOptions);

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
    console.log(`   Exporter: ${otlpEndpoint}`);
    if (otlpHeaders) {
      console.log('   Custom OTLP headers detected');
    }
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
