import { metrics } from '@opentelemetry/api';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { MeterProvider } from '@opentelemetry/sdk-metrics';

type CounterLike = { add: (value: number, attributes?: Record<string, unknown>) => void };
type HistogramLike = { record: (value: number, attributes?: Record<string, unknown>) => void };

const createNoopCounter = (): CounterLike => ({ add: () => {} });
const createNoopHistogram = (): HistogramLike => ({ record: () => {} });

const createNoopMeter = () => ({
  createCounter: () => createNoopCounter(),
  createHistogram: () => createNoopHistogram(),
});

const isBunRuntime =
  typeof (globalThis as any).Bun !== 'undefined' || typeof process.versions?.['bun'] === 'string';
const metricsEnabledEnv = process.env['OTEL_METRICS_ENABLED'] ?? process.env['METRICS_ENABLED'];
const metricsEnabled =
  metricsEnabledEnv !== undefined
    ? metricsEnabledEnv === 'true' || metricsEnabledEnv === '1'
    : !isBunRuntime;

let meter: {
  createCounter: (name: string, options?: Record<string, unknown>) => CounterLike;
  createHistogram: (name: string, options?: Record<string, unknown>) => HistogramLike;
} = createNoopMeter();

if (metricsEnabled) {
  try {
    const port = Number(process.env['OTEL_PROMETHEUS_PORT'] ?? 9464);
    const prometheusExporter = new PrometheusExporter({
      port,
      endpoint: '/metrics',
    });

    const meterProvider = new MeterProvider({
      // Exporter package versions can drift in monorepos; cast keeps runtime resilient.
      readers: [
        prometheusExporter as unknown as import('@opentelemetry/sdk-metrics').IMetricReader,
      ],
    });

    metrics.setGlobalMeterProvider(meterProvider);
    meter = metrics.getMeter('robot-dashboard-backend') as any;
  } catch (error) {
    // Fall back to no-op metrics if the SDK fails (prevents dev crash in Bun/OTEL combos).
    console.warn('Metrics disabled due to OpenTelemetry error:', error);
    meter = createNoopMeter();
  }
}

let metricsErrorLogged = false;
const safeCounter = (name: string, options?: Record<string, unknown>): CounterLike => {
  if (!metricsEnabled) return createNoopCounter();
  try {
    return meter.createCounter(name, options);
  } catch (error) {
    if (!metricsErrorLogged) {
      metricsErrorLogged = true;
      console.warn(`Metrics disabled after error in counter: ${name}`, error);
    }
    return createNoopCounter();
  }
};

const safeHistogram = (name: string, options?: Record<string, unknown>): HistogramLike => {
  if (!metricsEnabled) return createNoopHistogram();
  try {
    return meter.createHistogram(name, options);
  } catch (error) {
    if (!metricsErrorLogged) {
      metricsErrorLogged = true;
      console.warn(`Metrics disabled after error in histogram: ${name}`, error);
    }
    return createNoopHistogram();
  }
};

// Robot fleet metrics (based on existing robot collection) - simplified for Bun compatibility
export const robotFleetMetrics = {
  statusChanges: safeCounter('robot.fleet.status_changes', {
    description: 'Total number of robot status changes',
  }),
  // Note: totalCount and onlineCount removed due to Bun runtime compatibility issues with gauges
};

// API metrics
export const apiMetrics = {
  requestCount: safeCounter('api.requests.total', {
    description: 'Total number of API requests',
  }),
  requestDuration: safeHistogram('api.request.duration', {
    description: 'Duration of API requests in milliseconds',
    unit: 'ms',
  }),
  errorRate: safeCounter('api.errors.total', {
    description: 'Total number of API errors',
  }),
};

// WebSocket metrics - simplified for Bun compatibility
export const websocketMetrics = {
  messagesReceived: safeCounter('websocket.messages.received', {
    description: 'Total number of WebSocket messages received',
  }),
  connectionErrors: safeCounter('websocket.connection.errors', {
    description: 'Total number of WebSocket connection errors',
  }),
  // Note: activeConnections removed due to Bun runtime compatibility issues with gauges
};

// Database metrics - simplified for Bun compatibility
export const databaseMetrics = {
  queryDuration: safeHistogram('database.query.duration', {
    description: 'Duration of database queries in milliseconds',
    unit: 'ms',
  }),
  operationCount: safeCounter('database.operations.total', {
    description: 'Total number of database operations',
  }),
  // Note: connectionPool removed due to Bun runtime compatibility issues with gauges
};

// Auth metrics - simplified for Bun compatibility
export const authMetrics = {
  loginAttempts: safeCounter('auth.login.attempts', {
    description: 'Total number of login attempts',
  }),
  loginSuccess: safeCounter('auth.login.success', {
    description: 'Total number of successful logins',
  }),
  loginFailures: safeCounter('auth.login.failures', {
    description: 'Total number of failed logins',
  }),
  // Note: activeSessions removed due to Bun runtime compatibility issues with gauges
};

// Map management metrics - simplified for Bun compatibility
export const mapMetrics = {
  uploadCount: safeCounter('maps.uploads.total', {
    description: 'Total number of map uploads',
  }),
  downloadCount: safeCounter('maps.downloads.total', {
    description: 'Total number of map downloads',
  }),
  // Note: storageSize removed due to Bun runtime compatibility issues with gauges
};

export const emergencyMetrics = {
  connectionEvents: safeCounter('emergency.bridge.connections.total', {
    description: 'Total number of emergency bridge connection lifecycle events',
  }),
  stateTransitions: safeCounter('emergency.bridge.state_transitions.total', {
    description: 'Total number of observed emergency state transitions',
  }),
  dbSyncWrites: safeCounter('emergency.bridge.db_sync_writes.total', {
    description: 'Total number of robot status writes caused by emergency bridge state changes',
  }),
  snapshotTimeouts: safeCounter('emergency.bridge.snapshot_timeouts.total', {
    description:
      'Total number of emergency bridge connections that did not send an initial snapshot',
  }),
};
