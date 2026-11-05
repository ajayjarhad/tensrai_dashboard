import { expect, test } from 'bun:test';
import fastify from 'fastify';
import { appErrorHandler } from './errorHandler.js';

// Same cast as index.ts: fastify's default export has no call signature under NodeNext
const createFastify = fastify as unknown as (options?: object) => any;

const statusFor = async (error: Error) => {
  const app = createFastify({ logger: false });
  app.setErrorHandler(appErrorHandler as any);
  app.get('/', async () => {
    throw error;
  });
  const response = await app.inject({ method: 'GET', url: '/' });
  await app.close();
  return { status: response.statusCode, body: response.json() };
};

test('an id MongoDB cannot parse is not found, not a server error', async () => {
  const malformed = Object.assign(new Error('Malformed ObjectID: secret detail'), {
    code: 'P2023',
  });
  const { status, body } = await statusFor(malformed);
  expect(status).toBe(404);
  expect(JSON.stringify(body)).not.toContain('secret detail');
});

test('a query shape Prisma rejects is a bad request and reveals no details', async () => {
  const invalid = new Error('Invalid `prisma.missionRun.findMany()` invocation: secret detail');
  invalid.name = 'PrismaClientValidationError';
  const { status, body } = await statusFor(invalid);
  expect(status).toBe(400);
  expect(JSON.stringify(body)).not.toContain('secret detail');
});

test('anything else stays a 500 that says nothing', async () => {
  const { status, body } = await statusFor(new Error('database password is hunter2'));
  expect(status).toBe(500);
  expect(JSON.stringify(body)).not.toContain('hunter2');
});
