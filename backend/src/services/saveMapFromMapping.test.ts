import { afterEach, expect, test } from 'bun:test';
import fastify from 'fastify';
import type WebSocket from 'ws';
import { WebSocketServer } from 'ws';

const { fetchMapViaMappingBridge, getMapSyncStatus } = await import('./saveMapFromMapping.js');
const { default: robotRoutes } = await import('../routes/robots.js');

type TestMappingServer = {
  port: number;
  messages: string[];
  clients: Set<WebSocket>;
  close: () => Promise<void>;
};
type FastifyFactory = (options?: Record<string, unknown>) => any;

const createFastify = fastify as unknown as FastifyFactory;

const closeFns: Array<() => Promise<void>> = [];

const waitFor = async (predicate: () => boolean, timeoutMs = 1_000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for predicate');
};

const createLogger = () =>
  ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }) as any;

const startMappingServer = async (
  onMessage?: (socket: WebSocket, parsed: any) => void
): Promise<TestMappingServer> => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  const messages: string[] = [];
  const clients = new Set<WebSocket>();

  server.on('connection', socket => {
    clients.add(socket);
    socket.on('close', () => clients.delete(socket));
    socket.on('message', data => {
      const text = data.toString('utf8');
      const parsed = JSON.parse(text);
      messages.push(parsed.event);
      onMessage?.(socket, parsed);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.once('listening', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind mapping server');
  }

  const close = async () => {
    const closed = new Promise<void>(resolve => {
      const timeout = setTimeout(resolve, 250);
      timeout.unref?.();
      server.close(() => {
        clearTimeout(timeout);
        resolve();
      });
    });
    for (const client of clients) {
      client.terminate();
    }
    await closed;
  };
  closeFns.push(close);

  return { port: address.port, messages, clients, close };
};

afterEach(async () => {
  while (closeFns.length > 0) {
    await closeFns.pop()?.();
  }
});

test('updates map features from an unchanged manifest without downloading chunks', async () => {
  const mapUpdates: any[] = [];
  const robotUpdates: any[] = [];
  const server = await startMappingServer((socket, parsed) => {
    if (parsed.event !== 'GET_MAP_DATA') return;
    socket.send(
      JSON.stringify({
        event: 'MAP_MANIFEST',
        payload: {
          transferId: 'transfer-1',
          name: 'map',
          map_yaml: 'map.yaml',
          map_pgm: 'map.pgm',
          sha256: 'raw-image-hash',
          contentHash: 'stored-content-hash',
          total_chunks: 3,
          gzip_size: 1024,
          is_default: true,
          metadata_json: {
            locationTags: [{ tagId: 2, name: 'Dock', x: 1, y: 2, theta: 0 }],
            missions: [{ missionId: 7, name: 'Patrol', locationTagId: [2] }],
          },
        },
      })
    );
  });

  const prisma = {
    map: {
      findUnique: async () => ({ id: 'map-1', contentHash: 'stored-content-hash' }),
      update: async (args: any) => {
        mapUpdates.push(args);
        return { id: 'map-1', ...args.data };
      },
    },
    robot: {
      update: async (args: any) => {
        robotUpdates.push(args);
        return { id: args.where.id, mapId: 'map-1' };
      },
    },
  };

  await fetchMapViaMappingBridge(
    { log: createLogger(), prisma },
    { id: 'robot-metadata-refresh', ipAddress: '127.0.0.1', mappingBridgePort: server.port }
  );

  await waitFor(() => server.messages.includes('MAP_SKIP'));

  expect(server.messages).toContain('GET_MAP_DATA');
  expect(server.messages).toContain('MAP_SKIP');
  expect(server.messages).not.toContain('MAP_SEND_CHUNKS');
  expect(robotUpdates).toHaveLength(1);
  expect(mapUpdates).toHaveLength(1);
  expect(mapUpdates[0]).toMatchObject({
    where: { filename: 'map.yaml' },
    data: {
      features: {
        locationTags: [{ id: '2', name: 'Dock', x: 1, y: 2, theta: 0 }],
        missions: [
          {
            id: '7',
            name: 'Patrol',
            locationTagId: ['2'],
            steps: ['2'],
          },
        ],
      },
    },
  });
  expect(getMapSyncStatus('robot-metadata-refresh')).toMatchObject({
    phase: 'skipped',
    mapId: 'map-1',
  });
});

test('reuses the active map sync status instead of opening a duplicate socket', async () => {
  const server = await startMappingServer();
  const prisma = {
    map: {
      findUnique: async () => null,
    },
    robot: {
      update: async () => ({}),
    },
  };
  const fastify = { log: createLogger(), prisma };
  const robot = {
    id: 'robot-duplicate-sync',
    ipAddress: '127.0.0.1',
    mappingBridgePort: server.port,
  };

  await fetchMapViaMappingBridge(fastify, robot);
  await waitFor(() => server.clients.size === 1);

  const status = await fetchMapViaMappingBridge(fastify, robot);
  await new Promise(resolve => setTimeout(resolve, 50));

  expect(server.clients.size).toBe(1);
  expect(status).toMatchObject({
    phase: 'connecting',
    robotId: 'robot-duplicate-sync',
  });
});

test('manual map sync route rejects a saved robot without mapping bridge config', async () => {
  const app = createFastify({ logger: false }) as any;
  app.decorate('prisma', {
    robot: {
      findUnique: async () => ({
        id: 'robot-no-map-bridge',
        name: 'Robot without map bridge',
        ipAddress: '127.0.0.1',
        mappingBridgePort: null,
      }),
    },
  });

  await app.register(robotRoutes, { prefix: '/api' });

  const response = await app.inject({
    method: 'POST',
    url: '/api/robots/robot-no-map-bridge/map-sync',
  });

  await app.close();

  expect(response.statusCode).toBe(400);
  expect(response.json()).toMatchObject({
    success: false,
    error: 'Robot mapping bridge is not configured',
  });
});
