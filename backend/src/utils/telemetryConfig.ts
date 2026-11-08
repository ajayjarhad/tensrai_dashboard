export const isBunRuntime = typeof process.versions?.['bun'] === 'string';

// Both default to off under Bun unless the variables opt in. There the Node auto-instrumentation
// can't hook Bun's HTTP server, so only the code's own spans are exported.
export const isTracingEnabled = () => {
  const flag = process.env['OTEL_ENABLED'];
  if (flag !== undefined) return flag !== 'false';
  return (process.env['NODE_ENV'] ?? 'development') === 'production' || !isBunRuntime;
};

export const isMetricsEnabled = () => {
  const flag = process.env['OTEL_METRICS_ENABLED'] ?? process.env['METRICS_ENABLED'];
  if (flag !== undefined) return flag === 'true' || flag === '1';
  return !isBunRuntime;
};

// OTEL_EXPORTER_OTLP_ENDPOINT is the collector's base URL; each signal has its own path under it.
export const otlpUrl = (signal: 'traces' | 'metrics') => {
  const raw = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] || 'http://otel-collector:4318';
  const withScheme = raw.startsWith('http') ? raw : `http://${raw}`;
  const base = withScheme.replace(/\/+$/, '').replace(/\/v1\/(traces|metrics|logs)$/, '');
  return `${base}/v1/${signal}`;
};
