import { afterEach, expect, test } from 'bun:test';
import { isMetricsEnabled, isTracingEnabled, otlpUrl } from './telemetryConfig.js';

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

test('each signal gets its own path under the collector endpoint', () => {
  process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] = 'collector:4318/';
  expect([otlpUrl('traces'), otlpUrl('metrics')]).toEqual([
    'http://collector:4318/v1/traces',
    'http://collector:4318/v1/metrics',
  ]);

  process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] = 'https://otel.example.test/v1/traces';
  expect(otlpUrl('metrics')).toBe('https://otel.example.test/v1/metrics');
});

test('tracing and metrics stay off under Bun until the variables opt in', () => {
  delete process.env['OTEL_ENABLED'];
  delete process.env['OTEL_METRICS_ENABLED'];
  delete process.env['METRICS_ENABLED'];
  process.env['NODE_ENV'] = 'development';
  expect([isTracingEnabled(), isMetricsEnabled()]).toEqual([false, false]);

  process.env['OTEL_ENABLED'] = 'true';
  process.env['OTEL_METRICS_ENABLED'] = '1';
  expect([isTracingEnabled(), isMetricsEnabled()]).toEqual([true, true]);
});
