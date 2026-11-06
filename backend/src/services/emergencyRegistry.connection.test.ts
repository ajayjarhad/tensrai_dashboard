import { afterEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { WebSocketServer } from 'ws';

process.env['ROS_EMERGENCY_CONNECT_TIMEOUT_MS'] = '50';
process.env['ROS_EMERGENCY_HEARTBEAT_INTERVAL_MS'] = '50';

const { EmergencyRegistry } = await import('./emergencyRegistry.js');
type Registry = InstanceType<typeof EmergencyRegistry>;

const ROBOT_ID = 'robot-1';
const NOT_CONNECTED = { ok: false, error: 'Emergency bridge not connected' };
const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

const createRegistry = (port: number) => {
  const robot = {
    id: ROBOT_ID,
    orgId: 'org-1',
    name: 'Robot 1',
    status: 'IDLE',
    statusBeforeEmergency: null,
    ipAddress: '127.0.0.1',
    emergencyBridgePort: port,
  };
  const prisma = {
    robot: { findMany: async () => [robot] },
    robotAddress: { findMany: async () => [{ orgId: robot.orgId, ip: robot.ipAddress }] },
  } as any;
  const log = { info() {}, warn() {}, error() {} };
  const registry = new EmergencyRegistry(prisma, log);
  cleanups.push(() => registry.stop());
  return registry;
};

const statusOf = (registry: Registry) =>
  JSON.parse(registry.getRobotSnapshotEvent(ROBOT_ID)).payload.connectionStatus;

const waitFor = async (describe: () => string, predicate: () => boolean, timeoutMs = 1_000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await sleep(5);
  }
  throw new Error(`Timed out after ${timeoutMs}ms: ${describe()}`);
};

const waitForStatus = (registry: Registry, status: string) =>
  waitFor(
    () =>
      `wanted ${status}, still ${statusOf(registry)}, e-stop send returned ` +
      JSON.stringify(registry.sendSoftwareEmergency(ROBOT_ID, true)),
    () => statusOf(registry) === status
  );

const listen = async (server: net.Server) => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as net.AddressInfo).port;
};

// TCP accepted, optionally the WebSocket upgrade too, then total silence: what a bridge looks like
// from here once the robot loses power or its network goes away without a FIN.
const startSilentServer = async ({ upgrade }: { upgrade: boolean }) => {
  const sockets = new Set<net.Socket>();
  const stats = { upgrades: 0 };
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    if (!upgrade) return;
    socket.once('data', chunk => {
      const key = /sec-websocket-key: (.+)\r\n/i.exec(chunk.toString())?.[1];
      const accept = createHash('sha1')
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest('base64');
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
          `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
      );
      stats.upgrades += 1;
    });
  });
  const port = await listen(server);
  cleanups.push(() => {
    for (const socket of sockets) socket.destroy();
    server.close();
  });
  return { port, stats };
};

test('gives up on a bridge that accepts TCP but never upgrades', async () => {
  const { port } = await startSilentServer({ upgrade: false });
  const registry = createRegistry(port);

  await registry.reloadFromDb();
  expect(statusOf(registry)).toBe('connecting');

  await waitForStatus(registry, 'disconnected');
  expect(registry.sendSoftwareEmergency(ROBOT_ID, true)).toEqual(NOT_CONNECTED);
});

test('refuses the e-stop once a half-open bridge stops answering pings', async () => {
  const { port } = await startSilentServer({ upgrade: true });
  const registry = createRegistry(port);

  await registry.reloadFromDb();
  await waitForStatus(registry, 'connected');

  await waitForStatus(registry, 'disconnected');
  expect(registry.sendSoftwareEmergency(ROBOT_ID, true)).toEqual(NOT_CONNECTED);
});

test('reconnects after dropping a half-open bridge', async () => {
  const { port, stats } = await startSilentServer({ upgrade: true });
  const registry = createRegistry(port);

  await registry.reloadFromDb();

  await waitFor(
    () => `saw ${stats.upgrades} upgrade(s), status ${statusOf(registry)}`,
    () => stats.upgrades >= 2,
    2_000
  );
});

test('leaves a bridge that answers pings connected and able to take the e-stop', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise(resolve => server.once('listening', resolve));
  let connections = 0;
  const received: string[] = [];
  server.on('connection', socket => {
    connections += 1;
    socket.on('message', data => received.push(data.toString()));
  });
  cleanups.push(() => {
    for (const client of server.clients) client.terminate();
    server.close();
  });
  const registry = createRegistry((server.address() as net.AddressInfo).port);

  await registry.reloadFromDb();
  await waitForStatus(registry, 'connected');
  await sleep(300);

  expect(statusOf(registry)).toBe('connected');
  expect(connections).toBe(1);
  expect(registry.sendSoftwareEmergency(ROBOT_ID, true)).toEqual({ ok: true });
  await waitFor(
    () => `bridge received ${received.length} frames`,
    () => received.length === 1
  );
  expect(JSON.parse(received[0] ?? '')).toEqual({
    event: 'SOFTWARE_EMERGENCY',
    payload: { status: true },
  });
});
