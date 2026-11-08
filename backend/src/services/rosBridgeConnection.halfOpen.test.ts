import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { WebSocketServer } from 'ws';
import { RosBridgeConnection } from './rosBridgeConnection.js';
import { RosRobotManager } from './rosRobotManager.js';

const HEARTBEAT_MS = 30;
const HEARTBEAT_ENV = 'ROS_BRIDGE_HEARTBEAT_INTERVAL_MS';
const MOTION = { linear: { x: 0.25, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0.1 } };
const STOP = { linear: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } };
const cleanups: Array<() => void> = [];

beforeEach(() => {
  process.env[HEARTBEAT_ENV] = String(HEARTBEAT_MS);
});

afterEach(() => {
  delete process.env[HEARTBEAT_ENV];
  while (cleanups.length > 0) cleanups.pop()?.();
});

const waitFor = async (describe: () => string, predicate: () => boolean, timeoutMs = 1_000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await sleep(5);
  }
  throw new Error(`Timed out after ${timeoutMs}ms: ${describe()}`);
};

// The WebSocket upgrade completes, then total silence: what a bridge looks like from here once the
// robot loses power or its network goes away without a FIN.
const startSilentServer = async () => {
  const sockets = new Set<net.Socket>();
  const stats = { upgrades: 0 };
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
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
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => {
    for (const socket of sockets) socket.destroy();
    server.close();
  });
  return { url: `ws://127.0.0.1:${(server.address() as net.AddressInfo).port}`, stats };
};

const startBridge = async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise(resolve => server.once('listening', resolve));
  const frames: any[] = [];
  const stats = { connections: 0 };
  server.on('connection', socket => {
    stats.connections += 1;
    socket.on('message', data => frames.push(JSON.parse(data.toString())));
  });
  const dropClients = () => {
    for (const client of server.clients) client.terminate();
  };
  cleanups.push(() => {
    dropClients();
    server.close();
  });
  return {
    url: `ws://127.0.0.1:${(server.address() as net.AddressInfo).port}`,
    stats,
    dropClients,
    teleop: () =>
      frames.filter(f => f.op === 'publish' && f.topic === '/cmd_vel_ui').map(f => f.msg),
  };
};

const startConnection = async (
  url: string,
  options: { reconnectDelayMs?: number; maxReconnectDelayMs?: number } = {}
) => {
  const connection = new RosBridgeConnection({ id: 'control', url, ...options });
  const errors: string[] = [];
  connection.on('error', error => errors.push(error.message));
  cleanups.push(() => connection.disconnect());
  await connection.connect();
  return { connection, errors };
};

const startManager = async (controlUrl: string, defaultUrl: string, watchdogMs: number) => {
  const manager = new RosRobotManager({
    id: 'robot-1',
    connections: [
      { id: 'default', url: defaultUrl },
      { id: 'control', url: controlUrl },
    ],
    teleopLimits: { watchdogMs },
    channels: [
      {
        name: 'teleop',
        topic: '/cmd_vel_ui',
        msgType: 'geometry_msgs/msg/Twist',
        direction: 'publish',
        connectionId: 'control',
      },
    ],
  } as any);
  const errors: string[] = [];
  manager.on('error', (error: Error) => errors.push(error.message));
  cleanups.push(() => manager.stop());
  await manager.start();
  return { manager, errors };
};

const drive = (manager: RosRobotManager) =>
  manager.handleCommand('teleop', { linear: { x: 0.25 }, angular: { z: 0.1 } }) as {
    ok: boolean;
    connectionId?: string;
  };

test('a half-open bridge reads as disconnected and publish refuses', async () => {
  const { url } = await startSilentServer();
  const { connection, errors } = await startConnection(url);
  expect(connection.isConnected()).toBe(true);

  await waitFor(
    () => `still ${JSON.stringify(connection.getDebugStatus())}, publish throws nothing`,
    () => !connection.isConnected()
  );

  expect(() => connection.publish('/cmd_vel_ui', 'geometry_msgs/msg/Twist', STOP)).toThrow(
    'not ready'
  );
  expect(errors).toContainEqual(expect.stringContaining('stopped answering pings'));
});

test('reconnects after dropping a half-open bridge', async () => {
  const { url, stats } = await startSilentServer();
  await startConnection(url, { reconnectDelayMs: 5 });

  await waitFor(
    () => `saw ${stats.upgrades} upgrade(s)`,
    () => stats.upgrades >= 2
  );
});

test('a bridge that answers pings stays connected and receives what is published', async () => {
  const bridge = await startBridge();
  const { connection } = await startConnection(bridge.url);

  await sleep(HEARTBEAT_MS * 5);

  expect(connection.isConnected()).toBe(true);
  expect(bridge.stats.connections).toBe(1);
  connection.publish('/cmd_vel_ui', 'geometry_msgs/msg/Twist', STOP);
  await waitFor(
    () => `bridge received ${bridge.teleop().length} commands`,
    () => bridge.teleop().length === 1
  );
});

test('publishing while disconnected does not postpone the reconnect', async () => {
  const bridge = await startBridge();
  const { connection } = await startConnection(bridge.url, {
    reconnectDelayMs: 25,
    maxReconnectDelayMs: 50,
  });

  bridge.dropClients();
  await waitFor(
    () => 'bridge drop never noticed',
    () => !connection.isConnected()
  );

  const operatorHoldingTheStick = setInterval(() => {
    try {
      connection.publish('/cmd_vel_ui', 'geometry_msgs/msg/Twist', MOTION);
    } catch {}
  }, 5);
  cleanups.push(() => clearInterval(operatorHoldingTheStick));

  await waitFor(
    () => `still disconnected, ${bridge.stats.connections} connection(s) ever made`,
    () => connection.isConnected()
  );
});

test('teleop falls back to default once control goes half-open', async () => {
  const control = await startSilentServer();
  const fallback = await startBridge();
  const { manager } = await startManager(control.url, fallback.url, 60_000);

  expect(drive(manager)).toMatchObject({ ok: true, connectionId: 'control' });

  await waitFor(
    () =>
      `teleop still reports ok on ${drive(manager).connectionId}, ` +
      `default received ${fallback.teleop().length} commands`,
    () => drive(manager).connectionId === 'default'
  );
  await waitFor(
    () => `default received ${fallback.teleop().length} commands`,
    () => fallback.teleop().length > 0
  );
  expect(fallback.teleop()[0]).toEqual(MOTION);
});

test('a stop written into a half-open socket is re-sent once the socket is found dead', async () => {
  const control = await startSilentServer();
  const fallback = await startBridge();
  const { manager, errors } = await startManager(control.url, fallback.url, 5);

  expect(drive(manager)).toMatchObject({ ok: true, connectionId: 'control' });

  await waitFor(
    () => `default received ${JSON.stringify(fallback.teleop())}, errors ${errors}`,
    () => fallback.teleop().length > 0
  );
  expect(fallback.teleop()[0]).toEqual(STOP);
  expect(errors).toContainEqual(expect.stringContaining('Teleop stop unconfirmed'));
});

test('a new command supersedes a stop that was still unconfirmed', async () => {
  const control = await startSilentServer();
  const fallback = await startBridge();
  const { manager, errors } = await startManager(control.url, fallback.url, 5);

  drive(manager);
  await sleep(15);
  (manager as any).teleopLimits.watchdogMs = 60_000;
  expect(drive(manager)).toMatchObject({ ok: true, connectionId: 'control' });

  await waitFor(
    () => `teleop still on ${drive(manager).connectionId}`,
    () => drive(manager).connectionId === 'default'
  );

  expect(errors).not.toContainEqual(expect.stringContaining('Teleop stop unconfirmed'));
});

test('a stop the bridge has confirmed is not re-sent when the connection later drops', async () => {
  const control = await startBridge();
  const fallback = await startBridge();
  const { manager } = await startManager(control.url, fallback.url, 5);

  drive(manager);
  await waitFor(
    () => `control received ${JSON.stringify(control.teleop())}`,
    () => control.teleop().length === 2
  );
  await sleep(HEARTBEAT_MS * 3);

  control.dropClients();
  await sleep(HEARTBEAT_MS * 3);

  expect(fallback.teleop()).toEqual([]);
});

test('a stop on a publisher advertised a moment ago is repeated a bounded number of times', async () => {
  const control = await startBridge();
  const fallback = await startBridge();
  const { manager } = await startManager(control.url, fallback.url, 100);

  drive(manager);
  control.dropClients();

  await waitFor(
    () => `default received ${JSON.stringify(fallback.teleop())}`,
    () => fallback.teleop().length >= 5,
    2_000
  );
  await sleep(400);

  expect(fallback.teleop()).toEqual([STOP, STOP, STOP, STOP, STOP]);
});
