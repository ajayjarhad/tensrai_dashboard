import { afterEach, expect, test } from 'bun:test';
import fastify from 'fastify';
import { appErrorHandler } from './errorHandler.js';
import securityPlugin from './security.js';

// Same cast as index.ts: fastify's default export has no call signature under NodeNext
const createFastify = fastify as unknown as (options?: object) => any;

const previousEnv = { nodeEnv: process.env['NODE_ENV'], frontend: process.env['FRONTEND_URL'] };
afterEach(() => {
  process.env['NODE_ENV'] = previousEnv.nodeEnv;
  if (previousEnv.frontend === undefined) delete process.env['FRONTEND_URL'];
  else process.env['FRONTEND_URL'] = previousEnv.frontend;
});

const build = async (nodeEnv: string) => {
  process.env['NODE_ENV'] = nodeEnv;
  process.env['FRONTEND_URL'] = 'https://dashboard.example';
  const app = createFastify();
  await app.register(securityPlugin);
  app.setErrorHandler(appErrorHandler as any);
  app.post('/thing', async () => ({ ok: true }));
  await app.ready();
  return app;
};
const post = (app: any, origin: string) =>
  app.inject({ method: 'POST', url: '/thing', headers: { origin }, payload: {} });

for (const nodeEnv of ['development', 'production']) {
  test(`${nodeEnv}: another site gets no CORS access, and the request is not an error`, async () => {
    const app = await build(nodeEnv);
    const response = await post(app, 'https://evil.example');
    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();

    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/thing',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    });
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });

  test(`${nodeEnv}: the configured frontend keeps its access`, async () => {
    const app = await build(nodeEnv);
    const response = await post(app, 'https://dashboard.example');
    expect(response.headers['access-control-allow-origin']).toBe('https://dashboard.example');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    await app.close();
  });
}

test('local dev servers on any port are allowed only outside production', async () => {
  const dev = await build('development');
  expect((await post(dev, 'http://localhost:5199')).headers['access-control-allow-origin']).toBe(
    'http://localhost:5199'
  );
  await dev.close();

  const prod = await build('production');
  expect(
    (await post(prod, 'http://localhost:5199')).headers['access-control-allow-origin']
  ).toBeUndefined();
  await prod.close();
});
