import { expect, test } from 'bun:test';
import fastify from 'fastify';
import databasePlugin from './database.js';

const createFastify = fastify as unknown as () => any;

test('the public database health check does not say why the database is unreachable', async () => {
  const previousUrl = process.env['DATABASE_URL'];
  process.env['DATABASE_URL'] =
    'mongodb://127.0.0.1:1/unreachable?directConnection=true&serverSelectionTimeoutMS=100';
  const app = createFastify();
  try {
    await app.register(databasePlugin);
    const res = await app.inject({ method: 'GET', url: '/health/database' });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'unhealthy', database: 'disconnected' });
    expect(res.json().error).toBeUndefined();
    expect(res.body).not.toContain('127.0.0.1');
  } finally {
    await app.close();
    if (previousUrl === undefined) delete process.env['DATABASE_URL'];
    else process.env['DATABASE_URL'] = previousUrl;
  }
});
