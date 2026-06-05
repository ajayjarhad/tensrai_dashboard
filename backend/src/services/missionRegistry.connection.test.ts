import { afterEach, beforeEach, expect, test } from 'bun:test';
import net from 'node:net';
import { WebSocketServer } from 'ws';

process.env['ROS_MISSION_CONNECT_TIMEOUT_MS'] = '50';
process.env['ROS_MISSION_HEARTBEAT_INTERVAL_MS'] = '50';
process.env['ROS_MISSION_HEARTBEAT_TIMEOUT_MS'] = '50';

const { MissionRegistry } = await import('./missionRegistry.js');
type MissionRegistryInstance = InstanceType<typeof MissionRegistry>;

type TestRobot = {
  id: string;
  name: string;
  ipAddress: string;
  mapId: string | null;
  missionBridgePort: number;
  mappingBridgePort: number | null;
};

type TestLogger = {
  entries: Array<{ level: string; fields: Record<string, unknown>; message: string }>;
  info: (fields: Record<string, unknown>, message: string) => void;
  warn: (fields: Record<string, unknown>, message: string) => void;
  error: (fields: Record<string, unknown>, message: string) => void;
};

const registries: MissionRegistryInstance[] = [];
const closeFns: Array<() => Promise<void> | void> = [];

const waitFor = async (predicate: () => boolean, timeoutMs = 1_000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for predicate');
};

const waitForCloseCallback = async (close: (callback: () => void) => void) => {
  await new Promise<void>(resolve => {
    const timeout = setTimeout(resolve, 250);
    timeout.unref?.();
    close(() => {
      clearTimeout(timeout);
      resolve();
    });
  });
};

const createLogger = (): TestLogger => {
  const entries: TestLogger['entries'] = [];
  return {
    entries,
    info: (fields, message) => entries.push({ level: 'info', fields, message }),
    warn: (fields, message) => entries.push({ level: 'warn', fields, message }),
    error: (fields, message) => entries.push({ level: 'error', fields, message }),
  };
};

const createPrisma = (robots: TestRobot[]) =>
  ({
    robot: {
      findMany: async () => robots,
    },
    missionRun: {
      findMany: async () => [],
    },
  }) as any;

const createRegistry = (robots: TestRobot[], logger = createLogger()) => {
  const registry = new MissionRegistry(createPrisma(robots), logger);
  registries.push(registry);
  return { registry, logger };
};

const createRobot = (port: number): TestRobot => ({
  id: 'robot-1',
  name: 'Robot 1',
  ipAddress: '127.0.0.1',
  mapId: null,
  missionBridgePort: port,
  mappingBridgePort: null,
});

const startHungUpgradeServer = async () => {
  const sockets = new Set<net.Socket>();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  closeFns.push(async () => {
    for (const socket of sockets) {
      socket.destroy();
    }
    await waitForCloseCallback(resolve => server.close(resolve));
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind hung upgrade server');
  }
  return address.port;
};

const startHealthyMissionServer = async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  const received: string[] = [];
  server.on('connection', socket => {
    socket.on('message', data => {
      received.push(data.toString('utf8'));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.once('listening', () => {
      server.off('error', reject);
      resolve();
    });
  });

  closeFns.push(async () => {
    const closed = waitForCloseCallback(resolve => server.close(resolve));
    for (const client of server.clients) {
      client.terminate();
    }
    await closed;
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind mission server');
  }
  return { port: address.port, received };
};

beforeEach(() => {
  registries.length = 0;
  closeFns.length = 0;
});

afterEach(async () => {
  for (const registry of registries) {
    registry.stop();
  }
  while (closeFns.length > 0) {
    await closeFns.pop()?.();
  }
});

test('times out a mission bridge socket that accepts TCP but never upgrades', async () => {
  const port = await startHungUpgradeServer();
  const { registry } = createRegistry([createRobot(port)]);

  await registry.reloadFromDb();

  expect(registry.sendCommand('robot-1', '{"event":"START_MISSION","payload":{}}')).toEqual({
    ok: false,
    error: 'Mission bridge is still connecting',
  });

  await waitFor(() => registry.getStatuses()[0]?.status === 'disconnected');

  const status = registry.getStatuses()[0];
  expect(status).toMatchObject({
    robotId: 'robot-1',
    url: `ws://127.0.0.1:${port}`,
    status: 'disconnected',
    readyState: null,
    reconnectAttempt: 1,
  });
});

test('reload reconnects an unchanged URL when the existing mission socket is stale connecting', async () => {
  const port = await startHungUpgradeServer();
  const logger = createLogger();
  const { registry } = createRegistry([createRobot(port)], logger);

  await registry.reloadFromDb();
  const activeConnection = (registry as any).connections.get('robot-1');
  activeConnection.startedAt = Date.now() - 100;
  await registry.reloadFromDb();

  const staleLog = logger.entries.find(
    entry => entry.message === 'Mission bridge connection is stale during reload; reconnecting'
  );

  expect(staleLog?.fields).toMatchObject({
    robotId: 'robot-1',
    readyState: 0,
  });
});

test('sends mission commands over a healthy mission bridge socket', async () => {
  const { port, received } = await startHealthyMissionServer();
  const { registry } = createRegistry([createRobot(port)]);

  await registry.reloadFromDb();
  await waitFor(() => registry.getStatuses()[0]?.status === 'connected');

  expect(registry.sendCommand('robot-1', '{"event":"START_MISSION","payload":{}}')).toEqual({
    ok: true,
  });
  await waitFor(() => received.length === 1);

  expect(received[0]).toBe('{"event":"START_MISSION","payload":{}}');
  expect(registry.getStatuses()[0]).toMatchObject({
    robotId: 'robot-1',
    status: 'connected',
    readyState: 1,
    reconnectAttempt: 0,
  });
});
