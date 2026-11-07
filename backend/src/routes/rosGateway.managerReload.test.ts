import { afterEach, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';

const { default: rosGateway } = await import('./rosGateway.js');

type Handler = (connection: unknown, request: unknown) => unknown;

const ODOM = { channel: 'odom', data: { x: 1 } };
const FORWARDED_ODOM = JSON.stringify({ type: 'event', ...ODOM });
const UNREACHABLE_PORT = 1;

class FakeSocket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  sent: string[] = [];
  send(message: string) {
    this.sent.push(message);
  }
  close() {
    this.readyState = 3;
    this.emit('close');
  }
}

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

// The real RosRegistry reloading from a stubbed database, as an edit to a robot would trigger it.
const startGateway = async () => {
  const robot = { id: 'r1', orgId: 'o1', ipAddress: '127.0.0.1', bridgePort: UNREACHABLE_PORT };
  const db = { robots: [robot] as (typeof robot)[], approvedIps: ['127.0.0.1'] };
  const routes = new Map<string, Handler>();
  const log = { info() {}, warn() {}, error() {}, debug() {} };
  const stub: any = {
    log,
    prisma: {
      robot: { findMany: async () => db.robots },
      robotAddress: {
        findMany: async () => db.approvedIps.map(ip => ({ orgId: robot.orgId, ip })),
      },
    },
    decorate: (key: string, value: unknown) => {
      stub[key] = value;
    },
    register: async () => {},
    get: (path: string, _opts: unknown, handler: Handler) => routes.set(path, handler),
    addHook() {},
  };
  await (rosGateway as any)(stub, {});
  const registry = stub.rosRegistry;
  await registry.reloadFromDb();
  cleanups.push(() => registry.stop());

  const connectViewer = () => {
    const socket = new FakeSocket();
    routes.get('/ws/robots/:robotId/telemetry/:label')?.(socket, { params: { robotId: 'r1' } });
    cleanups.push(() => socket.close());
    return socket;
  };
  return { db, registry, robot, connectViewer };
};

test('a viewer that never sends a command follows the manager a config reload creates', async () => {
  const { registry, robot, connectViewer } = await startGateway();
  const viewer = connectViewer();
  const replaced = registry.getManager('r1');

  robot.bridgePort = UNREACHABLE_PORT + 1;
  await registry.reloadFromDb();
  const current = registry.getManager('r1');
  expect(current).not.toBe(replaced);

  current.emit('channel-data', { ...ODOM });

  expect(viewer.sent).toEqual([FORWARDED_ODOM]);
  expect(replaced.listenerCount('channel-data')).toBe(0);
});

test('a viewer connected while the robot has no manager attaches once it gets one', async () => {
  const { db, registry, connectViewer } = await startGateway();
  db.approvedIps = [];
  await registry.reloadFromDb();
  expect(registry.getManager('r1')).toBeUndefined();

  const viewer = connectViewer();
  db.approvedIps = ['127.0.0.1'];
  await registry.reloadFromDb();
  registry.getManager('r1').emit('channel-data', { ...ODOM });

  expect(viewer.sent).toEqual([FORWARDED_ODOM]);
});

test('a viewer resumes when a robot loses its manager and later gets a new one', async () => {
  const { db, registry, connectViewer } = await startGateway();
  const viewer = connectViewer();
  const removed = registry.getManager('r1');

  db.approvedIps = [];
  await registry.reloadFromDb();
  expect(removed.listenerCount('channel-data')).toBe(0);

  db.approvedIps = ['127.0.0.1'];
  await registry.reloadFromDb();
  registry.getManager('r1').emit('channel-data', { ...ODOM });

  expect(viewer.sent).toEqual([FORWARDED_ODOM]);
});

test('a closed viewer stops following the robot', async () => {
  const { registry, robot, connectViewer } = await startGateway();
  const viewer = connectViewer();

  viewer.close();
  robot.bridgePort = UNREACHABLE_PORT + 1;
  await registry.reloadFromDb();

  expect(registry.getManager('r1').listenerCount('channel-data')).toBe(0);
});
