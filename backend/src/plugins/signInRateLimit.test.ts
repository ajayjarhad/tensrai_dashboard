import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import fastify from 'fastify';
import authPlugin from './auth.js';
import { appErrorHandler } from './errorHandler.js';
import securityPlugin, { TRUSTED_PROXIES } from './security.js';

// Same cast as index.ts: fastify's default export has no call signature under NodeNext
const createFastify = fastify as unknown as (options?: object) => any;

// An account with no password fails at once, so the loops below don't run a bcrypt per attempt.
const prisma = { user: { findUnique: async () => ({ isActive: true, passwordHash: '' }) } };

// Registered in the same order as index.ts.
const app = createFastify({ trustProxy: TRUSTED_PROXIES });
app.setErrorHandler(appErrorHandler);
app.decorate('prisma', prisma);
await app.register(securityPlugin);
await app.register(authPlugin);
await app.ready();

const NGINX = '172.18.0.5';
const ATTEMPTS_PER_ACCOUNT = 10;
const ATTEMPTS_PER_ADDRESS = 100;

const attempt = (username: string, remoteAddress: string, headers: object = {}) =>
  app.inject({
    method: 'POST',
    url: '/api/auth/sign-in',
    remoteAddress,
    headers,
    payload: { username, password: 'guess' },
  });

test('the auth plugin refuses to start without the rate limiter', async () => {
  const unprotected = createFastify();
  unprotected.decorate('prisma', prisma);
  unprotected.register(authPlugin);
  await expect(unprotected.ready()).rejects.toThrow('@fastify/rate-limit');
});

test('one address cannot spread its guesses across any number of usernames', async () => {
  const attacker = '203.0.113.10';
  for (let i = 0; i < ATTEMPTS_PER_ADDRESS; i += 1) {
    const res = await attempt(`user-${i}`, attacker);
    expect([i, res.statusCode]).toEqual([i, 400]);
  }

  const blocked = await attempt('one-more', attacker);
  expect(blocked.statusCode).toBe(429);
  expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  expect(blocked.json()).toMatchObject({ success: false, code: 'RATE_LIMITED' });

  expect((await attempt('one-more', '203.0.113.11')).statusCode).toBe(400);
});

test('locking an account from one address leaves it open from another', async () => {
  for (let i = 0; i < ATTEMPTS_PER_ACCOUNT; i += 1) {
    expect((await attempt('victim', '203.0.113.20')).statusCode).toBe(400);
  }
  expect((await attempt('victim', '203.0.113.20')).statusCode).toBe(429);
  expect((await attempt('victim', '203.0.113.21')).statusCode).toBe(400);
});

test('behind nginx, clients are told apart by the address nginx saw', async () => {
  const through = (client: string) => attempt('shared', NGINX, { 'x-forwarded-for': client });
  for (let i = 0; i < ATTEMPTS_PER_ACCOUNT; i += 1) {
    expect((await through('203.0.113.30')).statusCode).toBe(400);
  }
  expect((await through('203.0.113.30')).statusCode).toBe(429);
  expect((await through('203.0.113.31')).statusCode).toBe(400);
});

test('a public client cannot change its key by forging X-Forwarded-For', async () => {
  const forged = (i: number) =>
    attempt('forged', NGINX, { 'x-forwarded-for': `198.51.100.${i}, 203.0.113.40` });
  for (let i = 0; i < ATTEMPTS_PER_ACCOUNT; i += 1) {
    expect((await forged(i)).statusCode).toBe(400);
  }
  expect((await forged(99)).statusCode).toBe(429);
});

// A client on a private network is a trusted hop to trustProxy, so anything it sent ahead of nginx's
// entry would become its address. Checked against real nginx by hand; this keeps the setting in place.
test('nginx replaces X-Forwarded-For instead of appending to what the client sent', () => {
  const conf = readFileSync(new URL('../../../docker/nginx/nginx.conf', import.meta.url), 'utf8');
  expect(conf).not.toContain('$proxy_add_x_forwarded_for');
  expect(conf.match(/X-Forwarded-For\s+\$remote_addr;/g)?.length).toBe(2);
});
