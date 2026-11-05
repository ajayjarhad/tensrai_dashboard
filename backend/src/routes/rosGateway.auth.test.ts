import { expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { connect } from 'node:net';
import { asUser, createTestApp, fakeRobotModel, ORG_A } from '../testing/authStub.js';

const { default: rosGateway } = await import('./rosGateway.js');

const SOCKET_PATHS = [
  '/ws/robots/r1',
  '/ws/robots/r1/telemetry/t',
  '/ws/robots/r1/mapping',
  '/ws/robots/r1/mapping/t',
  '/ws/robots/r1/emergency',
  '/ws/robots/r1/emergency/t',
];

const app = createTestApp();
app.decorate('prisma', {
  robot: fakeRobotModel([{ id: 'r1', orgId: ORG_A }]),
  robotAddress: { findMany: async () => [] },
});
await app.register(rosGateway);
await app.listen({ port: 0, host: '127.0.0.1' });
const { port } = app.server.address();

// A raw handshake: fastify's injectWS needs the real `ws` client, which Bun replaces with a shim,
// and a browser WebSocket hides the rejection status.
const handshakeStatus = (path: string, headers: Record<string, string> = {}) =>
  new Promise<number>((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => {
      const lines = [
        `GET ${path} HTTP/1.1`,
        `Host: 127.0.0.1:${port}`,
        'Connection: Upgrade',
        'Upgrade: websocket',
        'Sec-WebSocket-Version: 13',
        `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`,
        ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
      ];
      socket.write(`${lines.join('\r\n')}\r\n\r\n`);
    });
    socket.once('data', chunk => {
      socket.destroy();
      resolve(Number(/^HTTP\/1\.1 (\d+)/.exec(chunk.toString())?.[1]));
    });
    socket.once('error', reject);
  });

test('refuses the websocket upgrade without a session', async () => {
  for (const path of SOCKET_PATHS) {
    expect([path, await handshakeStatus(path)]).toEqual([path, 401]);
  }
});

test('refuses the upgrade for a disabled account and for a pending password setup', async () => {
  for (const path of SOCKET_PATHS) {
    expect([path, await handshakeStatus(path, asUser('disabled'))]).toEqual([path, 403]);
    expect([path, await handshakeStatus(path, asUser('needsReset'))]).toEqual([path, 428]);
  }
});

test('answers 404 to a socket for a robot of another organization', async () => {
  for (const path of SOCKET_PATHS) {
    expect([path, await handshakeStatus(path, asUser('otherOrgUser'))]).toEqual([path, 404]);
  }
  expect(await handshakeStatus('/ws/robots/bad/telemetry/t', asUser('user'))).toBe(404);
  expect(await handshakeStatus('/ws/robots/nobody/telemetry/t', asUser('user'))).toBe(404);
});

test('accepts the upgrade for a signed-in user', async () => {
  for (const path of SOCKET_PATHS) {
    expect([path, await handshakeStatus(path, asUser('user'))]).toEqual([path, 101]);
  }
});

test('keeps robot status behind a session', async () => {
  const anonymous = await app.inject({ method: 'GET', url: '/health/ros' });
  expect(anonymous.statusCode).toBe(401);

  const signedIn = await app.inject({ method: 'GET', url: '/health/ros', headers: asUser('user') });
  expect(signedIn.statusCode).toBe(200);
});

test('closes cleanly', async () => {
  await app.close();
});
