import { expect, test } from 'bun:test';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { NodeSDK, tracing } from '@opentelemetry/sdk-node';
import fastify from 'fastify';

const exporter = new tracing.InMemorySpanExporter();
const processor = new tracing.SimpleSpanProcessor(exporter);
// No resource detectors: their async attributes would hold every export back.
new NodeSDK({ spanProcessors: [processor], instrumentations: [], resourceDetectors: [] }).start();

const { default: observability } = await import('./observability.js');
const app = fastify();
await app.register(observability);
app.get('/items/:id', async () => {
  trace.getTracer('test').startSpan('items.load').end();
  return { ok: true };
});
app.get('/boom', async () => {
  throw new Error('boom');
});
await app.ready();

const spansFor = async (url: string) => {
  exporter.reset();
  await app.inject({ method: 'GET', url });
  await processor.forceFlush();
  return exporter.getFinishedSpans();
};

test('a request gets a server span named by its route, with the route’s own spans inside it', async () => {
  const spans = await spansFor('/items/42?secret=1');
  const server = spans.find(span => span.name === 'GET /items/:id');
  const inner = spans.find(span => span.name === 'items.load');

  expect(server?.attributes).toMatchObject({ 'http.status_code': 200, 'http.target': '/items/42' });
  expect(inner?.parentSpanContext?.spanId).toBe(server?.spanContext().spanId);
});

test('a failing request is marked as an error, with the exception recorded', async () => {
  const server = (await spansFor('/boom')).find(span => span.name === 'GET /boom');

  expect(server?.status.code).toBe(SpanStatusCode.ERROR);
  expect(server?.events.map(event => event.name)).toContain('exception');
});
