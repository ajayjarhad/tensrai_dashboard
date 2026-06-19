import { afterEach, expect, test } from 'bun:test';
import { createServer, type Socket } from 'node:net';
import fastify from 'fastify';
import type WebSocket from 'ws';
import { WebSocketServer } from 'ws';

const { fetchMapViaMappingBridge, getMapSyncStatus, upsertMapFromResponse } = await import(
  './saveMapFromMapping.js'
);
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

const makePgm = (width = 2, height = 2) =>
  Buffer.concat([Buffer.from(`P5\n${width} ${height}\n255\n`), Buffer.alloc(width * height, 128)]);

// In-memory fake Prisma modelling Map + RobotMap + Robot well enough to assert on
// the resulting active-map state after a sync, including the $transaction flow.
const createFakePrisma = (opts: { maps?: any[]; robotMaps?: any[]; robots?: any[] } = {}) => {
  const maps: any[] = opts.maps ? opts.maps.map(m => ({ ...m })) : [];
  const robotMaps: any[] = opts.robotMaps ? opts.robotMaps.map(r => ({ ...r })) : [];
  const robots: any[] = opts.robots ? opts.robots.map(r => ({ ...r })) : [];
  const robotUpdates: any[] = [];
  const mapUpdates: any[] = [];
  let mapSeq = maps.length;

  const findMap = (where: any) =>
    where.filename
      ? (maps.find(m => m.filename === where.filename) ?? null)
      : (maps.find(m => m.id === where.id) ?? null);

  const findRobotMap = (key: any) =>
    robotMaps.find(r => r.robotId === key.robotId && r.mapId === key.mapId) ?? null;

  const attachRobotMaps = (robot: any) => ({
    ...robot,
    robotMaps: robotMaps
      .filter(rm => rm.robotId === robot.id)
      .map(rm => {
        const map = maps.find(m => m.id === rm.mapId);
        return { ...rm, map: map ? { id: map.id, name: map.name } : null };
      }),
  });

  const prisma: any = {
    map: {
      findUnique: async ({ where }: any) => findMap(where),
      update: async ({ where, data }: any) => {
        mapUpdates.push({ where, data });
        const m = findMap(where);
        if (m) Object.assign(m, data);
        return m;
      },
      upsert: async ({ where, update, create }: any) => {
        let m = findMap(where);
        if (m) {
          Object.assign(m, update);
        } else {
          mapSeq += 1;
          m = { id: `map-${mapSeq}`, ...create };
          maps.push(m);
        }
        return m;
      },
    },
    robot: {
      findUnique: async ({ where, include }: any) => {
        const robot = robots.find(r => r.id === where.id);
        if (!robot) return null;
        return include?.robotMaps ? attachRobotMaps(robot) : { ...robot };
      },
      update: async (args: any) => {
        robotUpdates.push(args);
        const robot = robots.find(r => r.id === args.where.id);
        if (robot) Object.assign(robot, args.data);
        return robot ?? { id: args.where.id, ...args.data };
      },
    },
    robotMap: {
      findUnique: async ({ where }: any) => findRobotMap(where.robotId_mapId),
      upsert: async ({ where, update, create }: any) => {
        const key = where.robotId_mapId;
        let row = findRobotMap(key);
        if (row) {
          Object.assign(row, update);
        } else {
          row = { isActive: false, isPinned: false, ...create };
          robotMaps.push(row);
        }
        return row;
      },
      findMany: async ({ where }: any) => robotMaps.filter(r => r.robotId === where.robotId),
      update: async ({ where, data }: any) => {
        const row = findRobotMap(where.robotId_mapId);
        if (row) Object.assign(row, data);
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const row of robotMaps) {
          if (row.robotId === where.robotId) {
            Object.assign(row, data);
            count += 1;
          }
        }
        return { count };
      },
    },
    $transaction: async (ops: any[]) => Promise.all(ops),
  };

  return { prisma, maps, robotMaps, robots, robotUpdates, mapUpdates };
};

const startStalledTcpServer = async () => {
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
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

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind stalled TCP server');
  }

  closeFns.push(
    () =>
      new Promise(resolve => {
        for (const socket of sockets) {
          socket.destroy();
        }
        server.close(() => resolve());
      })
  );

  return { port: address.port };
};

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

  const { prisma, robotMaps, robotUpdates, mapUpdates } = createFakePrisma({
    maps: [{ id: 'map-1', filename: 'map.yaml', contentHash: 'stored-content-hash' }],
  });

  await fetchMapViaMappingBridge(
    { log: createLogger(), prisma },
    { id: 'robot-metadata-refresh', ipAddress: '127.0.0.1', mappingBridgePort: server.port }
  );

  await waitFor(() => server.messages.includes('MAP_SKIP'));

  expect(server.messages).toContain('GET_MAP_DATA');
  expect(server.messages).toContain('MAP_SKIP');
  expect(server.messages).not.toContain('MAP_SEND_CHUNKS');
  // Unchanged map is still linked via RobotMap and made active (was the only/first map).
  expect(robotMaps).toHaveLength(1);
  expect(robotMaps[0]).toMatchObject({
    robotId: 'robot-metadata-refresh',
    mapId: 'map-1',
    isActive: true,
  });
  // Legacy mapId dual-write happens once via designateActiveAfterSync.
  expect(robotUpdates).toHaveLength(1);
  expect(robotUpdates[0]).toMatchObject({ data: { mapId: 'map-1' } });
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

test('fails a map sync that cannot complete the websocket handshake', async () => {
  const server = await startStalledTcpServer();
  const prisma = {
    map: {
      findUnique: async () => null,
    },
    robot: {
      update: async () => ({}),
    },
  };
  const fastify = { log: createLogger(), prisma, mapSyncConnectTimeoutMs: 50 };

  await fetchMapViaMappingBridge(fastify, {
    id: 'robot-stalled-connect',
    ipAddress: '127.0.0.1',
    mappingBridgePort: server.port,
  });

  await waitFor(() => getMapSyncStatus('robot-stalled-connect').phase === 'failed', 500);

  expect(getMapSyncStatus('robot-stalled-connect')).toMatchObject({
    phase: 'failed',
    lastError: 'map-sync-connect-timeout',
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

const inlineYaml = (image: string) => `image: ${image}\nresolution: 0.05\norigin: [0, 0, 0]\n`;

test('links the primary and every additional map, activating the primary on first sync', async () => {
  const { prisma, maps, robotMaps, robotUpdates } = createFakePrisma();
  const files = {
    map_yaml: 'map.yaml',
    map_pgm: 'map.pgm',
    map_yaml_content: inlineYaml('map.pgm'),
    map_pgm_content: makePgm(),
    metadata_json: { locationTags: [], missions: [] },
    additional_maps: [
      {
        map_yaml: 'map1.yaml',
        map_pgm: 'map1.pgm',
        map_yaml_content: inlineYaml('map1.pgm'),
        map_pgm_content: makePgm(),
        metadata_json: { locationTags: [], missions: [] },
      },
    ],
  };

  const primary = await upsertMapFromResponse(
    { log: createLogger(), prisma },
    'robot-multi',
    files
  );

  // Both the primary and the additional map are stored and linked (no orphaning).
  expect(maps).toHaveLength(2);
  expect(robotMaps).toHaveLength(2);
  const primaryRow = robotMaps.find((r: any) => r.mapId === primary.id);
  const extraRow = robotMaps.find((r: any) => r.mapId !== primary.id);
  expect(primaryRow).toMatchObject({ robotId: 'robot-multi', isActive: true });
  expect(extraRow).toMatchObject({ robotId: 'robot-multi', isActive: false });
  expect(robotUpdates).toHaveLength(1);
  expect(robotUpdates[0]).toMatchObject({ data: { mapId: primary.id } });
});

test('does not override a pinned active map on re-sync', async () => {
  const { prisma, robotMaps, robotUpdates } = createFakePrisma({
    maps: [{ id: 'map-pinned', filename: 'map1.yaml', contentHash: 'h' }],
    robotMaps: [{ robotId: 'robot-pin', mapId: 'map-pinned', isActive: true, isPinned: true }],
  });
  const files = {
    map_yaml: 'map.yaml',
    map_pgm: 'map.pgm',
    map_yaml_content: inlineYaml('map.pgm'),
    map_pgm_content: makePgm(),
    metadata_json: { locationTags: [], missions: [] },
  };

  await upsertMapFromResponse({ log: createLogger(), prisma }, 'robot-pin', files);

  const pinned = robotMaps.find((r: any) => r.mapId === 'map-pinned');
  const newlySynced = robotMaps.find((r: any) => r.mapId !== 'map-pinned');
  expect(pinned).toMatchObject({ isActive: true, isPinned: true });
  expect(newlySynced).toMatchObject({ isActive: false });
  expect(robotUpdates).toHaveLength(0);
});

test('keeps the existing unpinned active map on re-sync', async () => {
  const { prisma, robotMaps, robotUpdates } = createFakePrisma({
    maps: [{ id: 'map-active', filename: 'map.yaml', contentHash: 'h' }],
    robotMaps: [{ robotId: 'robot-keep', mapId: 'map-active', isActive: true, isPinned: false }],
  });
  const files = {
    map_yaml: 'map.yaml',
    map_pgm: 'map.pgm',
    map_yaml_content: inlineYaml('map.pgm'),
    map_pgm_content: makePgm(),
    metadata_json: { locationTags: [], missions: [] },
  };

  await upsertMapFromResponse({ log: createLogger(), prisma }, 'robot-keep', files);

  expect(robotMaps).toHaveLength(1);
  expect(robotMaps[0]).toMatchObject({ mapId: 'map-active', isActive: true });
  expect(robotUpdates).toHaveLength(0);
});

const registerRobotApp = async (prisma: any) => {
  const app = createFastify({ logger: false }) as any;
  app.decorate('prisma', prisma);
  await app.register(robotRoutes, { prefix: '/api' });
  return app;
};

test('POST /active-map activates and pins the chosen map', async () => {
  const { prisma, robotMaps } = createFakePrisma({
    robots: [{ id: 'r1', name: 'R1' }],
    maps: [
      { id: 'm1', name: 'Map One' },
      { id: 'm2', name: 'Map Two' },
    ],
    robotMaps: [
      { robotId: 'r1', mapId: 'm1', isActive: true, isPinned: false },
      { robotId: 'r1', mapId: 'm2', isActive: false, isPinned: false },
    ],
  });
  const app = await registerRobotApp(prisma);

  const response = await app.inject({
    method: 'POST',
    url: '/api/robots/r1/active-map',
    payload: { mapId: 'm2' },
  });
  await app.close();

  expect(response.statusCode).toBe(200);
  expect(robotMaps.find((r: any) => r.mapId === 'm2')).toMatchObject({
    isActive: true,
    isPinned: true,
  });
  expect(robotMaps.find((r: any) => r.mapId === 'm1')).toMatchObject({ isActive: false });
  expect(response.json().data).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: 'm2', isActive: true, isPinned: true })])
  );
});

test('POST /active-map returns 404 for a map not assigned to the robot', async () => {
  const { prisma } = createFakePrisma({
    robots: [{ id: 'r1', name: 'R1' }],
    maps: [{ id: 'm1', name: 'Map One' }],
    robotMaps: [{ robotId: 'r1', mapId: 'm1', isActive: true, isPinned: false }],
  });
  const app = await registerRobotApp(prisma);

  const response = await app.inject({
    method: 'POST',
    url: '/api/robots/r1/active-map',
    payload: { mapId: 'does-not-exist' },
  });
  await app.close();

  expect(response.statusCode).toBe(404);
  expect(response.json()).toMatchObject({
    success: false,
    error: 'Map is not assigned to this robot',
  });
});

test('POST /active-map/auto clears the pin on a robot’s maps', async () => {
  const { prisma, robotMaps } = createFakePrisma({
    robots: [{ id: 'r1', name: 'R1' }],
    maps: [{ id: 'm1', name: 'Map One' }],
    robotMaps: [{ robotId: 'r1', mapId: 'm1', isActive: true, isPinned: true }],
  });
  const app = await registerRobotApp(prisma);

  const response = await app.inject({ method: 'POST', url: '/api/robots/r1/active-map/auto' });
  await app.close();

  expect(response.statusCode).toBe(200);
  expect(robotMaps.find((r: any) => r.mapId === 'm1')).toMatchObject({
    isPinned: false,
    isActive: true,
  });
});
