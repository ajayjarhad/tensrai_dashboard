import { afterEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { createServer, type Socket } from 'node:net';
import { gzipSync } from 'node:zlib';
import type WebSocket from 'ws';
import { WebSocketServer } from 'ws';
import { asUser, createTestApp, ORG_A as ORG } from '../testing/authStub.js';

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

  const findMap = (where: any) => maps.find(m => m.id === where.id) ?? null;

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
      findFirst: async ({ where }: any) =>
        maps.find(
          m =>
            m.orgId === where.orgId &&
            m.filename === where.filename &&
            where.contentHash.in.includes(m.contentHash)
        ) ?? null,
      create: async ({ data }: any) => {
        mapSeq += 1;
        const m = { id: `map-${mapSeq}`, ...data };
        maps.push(m);
        return m;
      },
      update: async ({ where, data }: any) => {
        mapUpdates.push({ where, data });
        const m = findMap(where);
        if (m) Object.assign(m, data);
        return m;
      },
    },
    robot: {
      findFirst: async ({ where }: any) =>
        robots.find(r => r.id === where.id && r.orgId === where.orgId) ?? null,
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
      updateMany: async ({ where, data }: any) => {
        const matching = robots.filter(r => r.id === where.id && r.mapId === where.mapId);
        for (const robot of matching) Object.assign(robot, data);
        return { count: matching.length };
      },
    },
    robotMap: {
      findUnique: async ({ where }: any) => findRobotMap(where.robotId_mapId),
      findFirst: async ({ where }: any) =>
        robotMaps.find(
          r =>
            r.robotId === where.robotId &&
            maps.find(m => m.id === r.mapId)?.filename === where.map.filename
        ) ?? null,
      count: async ({ where }: any) =>
        robotMaps.filter(r => r.mapId === where.mapId && r.robotId !== where.robotId.not).length,
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
    robotAddress: { findFirst: async () => ({ id: 'approved-address' }) },
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
    maps: [{ id: 'map-1', orgId: ORG, filename: 'map.yaml', contentHash: 'stored-content-hash' }],
    robots: [{ id: 'robot-metadata-refresh', orgId: ORG }],
  });

  await fetchMapViaMappingBridge(
    { log: createLogger(), prisma },
    {
      id: 'robot-metadata-refresh',
      orgId: ORG,
      ipAddress: '127.0.0.1',
      mappingBridgePort: server.port,
    }
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
    where: { id: 'map-1' },
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
    robotAddress: { findFirst: async () => ({ id: 'approved-address' }) },
  };
  const fastify = { log: createLogger(), prisma };
  const robot = {
    id: 'robot-duplicate-sync',
    orgId: ORG,
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

test('refuses a map that decompresses to more than the limit', async () => {
  const server = await startMappingServer((socket, parsed) => {
    const transferId = 'bomb';
    if (parsed.event === 'GET_MAP_DATA') {
      socket.send(
        JSON.stringify({
          event: 'MAP_MANIFEST',
          payload: {
            transferId,
            name: 'bomb',
            map_yaml: 'bomb.yaml',
            map_pgm: 'bomb.pgm',
            sha256: 'unchecked',
            total_chunks: 1,
            gzip_size: 1024,
          },
        })
      );
    }
    if (parsed.event === 'MAP_SEND_CHUNKS') {
      const data = gzipSync(Buffer.alloc(100_000)).toString('base64');
      socket.send(JSON.stringify({ event: 'MAP_CHUNK', payload: { transferId, index: 0, data } }));
      socket.send(JSON.stringify({ event: 'MAP_TRANSFER_COMPLETE', payload: { transferId } }));
    }
  });
  const { prisma, maps } = createFakePrisma({ robots: [{ id: 'robot-bomb', orgId: ORG }] });

  await fetchMapViaMappingBridge(
    { log: createLogger(), prisma, maxMapImageBytes: 1_000 },
    { id: 'robot-bomb', orgId: ORG, ipAddress: '127.0.0.1', mappingBridgePort: server.port }
  );

  await waitFor(() => getMapSyncStatus('robot-bomb').phase === 'failed');
  expect(maps).toHaveLength(0);
});

test('never connects to a robot whose address is not approved', async () => {
  const server = await startMappingServer();
  const prisma = { robotAddress: { findFirst: async () => null } };

  const status = await fetchMapViaMappingBridge(
    { log: createLogger(), prisma },
    {
      id: 'robot-unapproved',
      orgId: ORG,
      ipAddress: '127.0.0.1',
      mappingBridgePort: server.port,
    }
  );
  await new Promise(resolve => setTimeout(resolve, 50));

  expect(status).toBeUndefined();
  expect(server.clients.size).toBe(0);
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
    robotAddress: { findFirst: async () => ({ id: 'approved-address' }) },
  };
  const fastify = { log: createLogger(), prisma, mapSyncConnectTimeoutMs: 50 };

  await fetchMapViaMappingBridge(fastify, {
    id: 'robot-stalled-connect',
    orgId: ORG,
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
  const app = createTestApp();
  app.decorate('prisma', {
    robot: {
      findFirst: async () => ({ id: 'robot-no-map-bridge' }),
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
    headers: asUser('user'),
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
  const { prisma, maps, robotMaps, robotUpdates } = createFakePrisma({
    robots: [{ id: 'robot-multi', orgId: ORG }],
  });
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
    maps: [{ id: 'map-pinned', orgId: ORG, filename: 'map1.yaml', contentHash: 'h' }],
    robots: [{ id: 'robot-pin', orgId: ORG }],
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
    maps: [{ id: 'map-active', orgId: ORG, filename: 'map.yaml', contentHash: 'h' }],
    robots: [{ id: 'robot-keep', orgId: ORG }],
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

const floorFiles = (pgm: Buffer, missions: any[] = []) => ({
  map_yaml: 'map.yaml',
  map_pgm: 'map.pgm',
  map_yaml_content: inlineYaml('map.pgm'),
  map_pgm_content: pgm,
  metadata_json: { locationTags: [], missions },
});

const twoRobots = () =>
  createFakePrisma({
    robots: [
      { id: 'r1', orgId: ORG },
      { id: 'r2', orgId: ORG },
    ],
  });

const activeMapOf = ({ maps, robotMaps }: ReturnType<typeof createFakePrisma>, robotId: string) => {
  const link = robotMaps.find(r => r.robotId === robotId && r.isActive);
  return maps.find(m => m.id === link?.mapId);
};

const FLOOR_ONE = makePgm(2, 2);
const FLOOR_TWO = makePgm(3, 3);

test('robots syncing different floors under one filename keep separate maps', async () => {
  const state = twoRobots();
  const fastify = { log: createLogger(), prisma: state.prisma };

  await upsertMapFromResponse(fastify, 'r1', floorFiles(FLOOR_ONE, [{ id: 1, name: 'Floor one' }]));
  await upsertMapFromResponse(fastify, 'r2', floorFiles(FLOOR_TWO, [{ id: 2, name: 'Floor two' }]));

  expect(state.maps).toHaveLength(2);
  expect(activeMapOf(state, 'r1')?.image).toEqual(FLOOR_ONE);
  expect(activeMapOf(state, 'r1')?.features.missions[0].name).toBe('Floor one');
  expect(activeMapOf(state, 'r2')?.image).toEqual(FLOOR_TWO);
  expect(activeMapOf(state, 'r2')?.features.missions[0].name).toBe('Floor two');
});

const approved = () => ({
  ...twoRobots().prisma,
  robotAddress: { findFirst: async () => ({ id: 'approved' }) },
});

test('a robot cannot replace a good floor with data nobody can use', async () => {
  const state = twoRobots();
  const fastify = { log: createLogger(), prisma: state.prisma };
  const good = floorFiles(FLOOR_ONE);
  const stored = await upsertMapFromResponse(fastify, 'r1', good);
  const before = { ...state.maps[0] };

  for (const bad of [
    { ...good, map_pgm_content: Buffer.from('this is not a pgm').toString('base64') },
    { ...good, map_yaml_content: ': : : [not yaml' },
    { ...good, map_yaml_content: 'just a string' },
    { ...good, map_yaml: '../../etc/passwd.yaml' },
    { ...good, map_yaml: '<img src=x onerror=alert(1)>.yaml' },
  ]) {
    expect(await upsertMapFromResponse(fastify, 'r1', bad)).toBeFalsy();
  }

  expect(state.maps).toHaveLength(1);
  expect(state.maps[0].id).toBe(stored.id);
  expect(state.maps[0].contentHash).toBe(before.contentHash);
});

test('a robot answering "no map files" ends the sync with that reason, immediately', async () => {
  const server = await startMappingServer(socket => {
    socket.send(
      JSON.stringify({
        event: 'MAP_DATA_RESPONSE',
        payload: { files: null, error: 'No map files found' },
      })
    );
  });
  await fetchMapViaMappingBridge(
    { log: createLogger(), prisma: approved() },
    { id: 'robot-empty', orgId: ORG, ipAddress: '127.0.0.1', mappingBridgePort: server.port }
  );
  await waitFor(() => getMapSyncStatus('robot-empty').phase === 'failed');
  expect(getMapSyncStatus('robot-empty').lastError).toBe('No map files found');
});

test('messages arriving after a failed transfer cannot make the sync look active again', async () => {
  const manifest = (transferId: string) =>
    JSON.stringify({
      event: 'MAP_MANIFEST',
      payload: {
        transferId,
        map_yaml: `${transferId}.yaml`,
        map_pgm: `${transferId}.pgm`,
        map_yaml_content: inlineYaml(`${transferId}.pgm`),
        sha256: '0'.repeat(64),
        total_chunks: 1,
        gzip_size: 1,
      },
    });
  const server = await startMappingServer((socket, { event, payload }) => {
    if (event === 'GET_MAP_DATA') socket.send(manifest('first'));
    if (event === 'MAP_SEND_CHUNKS' && payload.transferId === 'first') {
      const chunk = { transferId: 'first', index: 0, data: gzipSync(FLOOR_ONE).toString('base64') };
      socket.send(JSON.stringify({ event: 'MAP_CHUNK', payload: chunk }));
      socket.send(
        JSON.stringify({ event: 'MAP_TRANSFER_COMPLETE', payload: { transferId: 'first' } })
      );
      // Already on the wire when the backend rejects the first map.
      socket.send(manifest('second'));
    }
  });
  // A database lookup slower than the socket closing, as on a real deployment.
  const prisma: any = approved();
  const findMap = prisma.map.findFirst;
  prisma.map = {
    ...prisma.map,
    findFirst: async (args: any) => {
      await new Promise(resolve => setTimeout(resolve, 50));
      return findMap(args);
    },
  };
  await fetchMapViaMappingBridge(
    { log: createLogger(), prisma },
    { id: 'robot-revive', orgId: ORG, ipAddress: '127.0.0.1', mappingBridgePort: server.port }
  );
  await waitFor(() => getMapSyncStatus('robot-revive').phase === 'failed');
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(getMapSyncStatus('robot-revive').phase).toBe('failed');
});

test('a re-mapped floor updates only that robot’s map, keeping its id', async () => {
  const state = twoRobots();
  const fastify = { log: createLogger(), prisma: state.prisma };
  const remapped = makePgm(4, 4);

  await upsertMapFromResponse(fastify, 'r1', floorFiles(FLOOR_ONE));
  await upsertMapFromResponse(fastify, 'r2', floorFiles(FLOOR_TWO));
  const r2MapId = activeMapOf(state, 'r2')?.id;
  await upsertMapFromResponse(fastify, 'r2', floorFiles(remapped));

  expect(state.maps).toHaveLength(2);
  expect(activeMapOf(state, 'r2')).toMatchObject({ id: r2MapId, image: remapped });
  expect(activeMapOf(state, 'r1')?.image).toEqual(FLOOR_ONE);
});

test('robots syncing identical content share one map record', async () => {
  const state = twoRobots();
  const fastify = { log: createLogger(), prisma: state.prisma };

  await upsertMapFromResponse(fastify, 'r1', floorFiles(FLOOR_ONE));
  await upsertMapFromResponse(fastify, 'r2', floorFiles(FLOOR_ONE));

  expect(state.maps).toHaveLength(1);
  expect(state.robotMaps.map(r => [r.robotId, r.mapId, r.isActive])).toEqual([
    ['r1', state.maps[0].id, true],
    ['r2', state.maps[0].id, true],
  ]);
});

test('a robot whose shared map changes splits off, keeping its active and pinned state', async () => {
  const state = twoRobots();
  const fastify = { log: createLogger(), prisma: state.prisma };

  await upsertMapFromResponse(fastify, 'r1', floorFiles(FLOOR_ONE));
  await upsertMapFromResponse(fastify, 'r2', floorFiles(FLOOR_ONE));
  const sharedId = state.maps[0].id;
  Object.assign(
    state.robotMaps.find(r => r.robotId === 'r1'),
    { isPinned: true }
  );

  await upsertMapFromResponse(fastify, 'r1', floorFiles(FLOOR_TWO));

  expect(state.maps).toHaveLength(2);
  expect(activeMapOf(state, 'r2')).toMatchObject({ id: sharedId, image: FLOOR_ONE });
  expect(activeMapOf(state, 'r1')?.image).toEqual(FLOOR_TWO);
  expect(activeMapOf(state, 'r1')?.id).not.toBe(sharedId);

  const r1Links = state.robotMaps.filter(r => r.robotId === 'r1');
  expect(r1Links).toHaveLength(1);
  expect(r1Links[0]).toMatchObject({ isActive: true, isPinned: true });
  expect(state.robots.find(r => r.id === 'r1')?.mapId).toBe(r1Links[0].mapId);
});

test('a robot syncing content another robot already stored joins that record', async () => {
  const state = twoRobots();
  const fastify = { log: createLogger(), prisma: state.prisma };

  await upsertMapFromResponse(fastify, 'r1', floorFiles(FLOOR_ONE));
  await upsertMapFromResponse(fastify, 'r2', floorFiles(FLOOR_TWO));
  const r1MapId = activeMapOf(state, 'r1')?.id;

  await upsertMapFromResponse(fastify, 'r2', floorFiles(FLOOR_ONE));

  expect(state.robotMaps.filter(r => r.robotId === 'r2')).toHaveLength(1);
  expect(activeMapOf(state, 'r2')?.id).toBe(r1MapId);
  expect(state.robots.find(r => r.id === 'r2')?.mapId).toBe(r1MapId);
});

test('a manifest matching another robot’s map links it without downloading', async () => {
  const server = await startMappingServer((socket, parsed) => {
    if (parsed.event !== 'GET_MAP_DATA') return;
    socket.send(
      JSON.stringify({
        event: 'MAP_MANIFEST',
        payload: {
          transferId: 'shared-floor',
          name: 'map',
          map_yaml: 'map.yaml',
          map_pgm: 'map.pgm',
          sha256: 'raw-image-hash',
          contentHash: 'floor-hash',
          total_chunks: 1,
          is_default: false,
        },
      })
    );
  });
  const { prisma, robotMaps } = createFakePrisma({
    maps: [{ id: 'floor', orgId: ORG, filename: 'map.yaml', contentHash: 'floor-hash' }],
    robots: [
      { id: 'r1', orgId: ORG },
      { id: 'r2', orgId: ORG },
    ],
    robotMaps: [{ robotId: 'r1', mapId: 'floor', isActive: true, isPinned: false }],
  });

  await fetchMapViaMappingBridge(
    { log: createLogger(), prisma },
    { id: 'r2', orgId: ORG, ipAddress: '127.0.0.1', mappingBridgePort: server.port }
  );
  await waitFor(() => server.messages.includes('MAP_SKIP'));

  expect(server.messages).not.toContain('MAP_SEND_CHUNKS');
  expect(robotMaps.find(r => r.robotId === 'r2')).toMatchObject({
    mapId: 'floor',
    isActive: false,
  });
});

test('a transfer under another robot’s filename stores a new map instead of overwriting', async () => {
  const transferId = 'other-floor';
  const server = await startMappingServer((socket, parsed) => {
    if (parsed.event === 'GET_MAP_DATA') {
      socket.send(
        JSON.stringify({
          event: 'MAP_MANIFEST',
          payload: {
            transferId,
            name: 'map',
            map_yaml: 'map.yaml',
            map_pgm: 'map.pgm',
            map_yaml_content: inlineYaml('map.pgm'),
            sha256: createHash('sha256').update(FLOOR_TWO).digest('hex'),
            total_chunks: 1,
            is_default: true,
          },
        })
      );
    }
    if (parsed.event === 'MAP_SEND_CHUNKS') {
      const data = gzipSync(FLOOR_TWO).toString('base64');
      socket.send(JSON.stringify({ event: 'MAP_CHUNK', payload: { transferId, index: 0, data } }));
      socket.send(JSON.stringify({ event: 'MAP_TRANSFER_COMPLETE', payload: { transferId } }));
    }
  });
  const state = createFakePrisma({
    maps: [
      { id: 'floor', orgId: ORG, filename: 'map.yaml', contentHash: 'floor', image: FLOOR_ONE },
    ],
    robots: [
      { id: 'r1', orgId: ORG },
      { id: 'r2', orgId: ORG },
    ],
    robotMaps: [{ robotId: 'r1', mapId: 'floor', isActive: true, isPinned: false }],
  });

  await fetchMapViaMappingBridge(
    { log: createLogger(), prisma: state.prisma },
    { id: 'r2', orgId: ORG, ipAddress: '127.0.0.1', mappingBridgePort: server.port }
  );
  await waitFor(() => getMapSyncStatus('r2').phase === 'complete');

  expect(state.maps).toHaveLength(2);
  expect(activeMapOf(state, 'r1')).toMatchObject({ id: 'floor', image: FLOOR_ONE });
  expect(activeMapOf(state, 'r2')?.image).toEqual(FLOOR_TWO);
});

const registerRobotApp = async (prisma: any) => {
  const app = createTestApp();
  app.decorate('prisma', prisma);
  await app.register(robotRoutes, { prefix: '/api' });
  return app;
};

test('POST /active-map activates and pins the chosen map', async () => {
  const { prisma, robotMaps } = createFakePrisma({
    robots: [{ id: 'r1', name: 'R1', orgId: ORG }],
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
    headers: asUser('user'),
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
    robots: [{ id: 'r1', name: 'R1', orgId: ORG }],
    maps: [{ id: 'm1', name: 'Map One' }],
    robotMaps: [{ robotId: 'r1', mapId: 'm1', isActive: true, isPinned: false }],
  });
  const app = await registerRobotApp(prisma);

  const response = await app.inject({
    method: 'POST',
    url: '/api/robots/r1/active-map',
    headers: asUser('user'),
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
    robots: [{ id: 'r1', name: 'R1', orgId: ORG }],
    maps: [{ id: 'm1', name: 'Map One' }],
    robotMaps: [{ robotId: 'r1', mapId: 'm1', isActive: true, isPinned: true }],
  });
  const app = await registerRobotApp(prisma);

  const response = await app.inject({
    method: 'POST',
    url: '/api/robots/r1/active-map/auto',
    headers: asUser('user'),
  });
  await app.close();

  expect(response.statusCode).toBe(200);
  expect(robotMaps.find((r: any) => r.mapId === 'm1')).toMatchObject({
    isPinned: false,
    isActive: true,
  });
});
