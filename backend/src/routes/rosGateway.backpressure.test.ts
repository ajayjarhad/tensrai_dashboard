import { expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';

const { default: rosGateway } = await import('./rosGateway.js');

type Handler = (connection: unknown, request: unknown) => unknown;

// Minimal Fastify stand-in: captures websocket route handlers and exposes a manager.
const createFastifyStub = () => {
  const routes = new Map<string, Handler>();
  const warnings: unknown[] = [];
  const stub: any = {
    log: { info() {}, warn: (f: unknown) => warnings.push(f), error() {}, debug() {} },
    prisma: { robot: { findMany: async () => [] } },
    decorate: (key: string, value: unknown) => {
      stub[key] = value;
    },
    register: async () => {},
    get: (path: string, _opts: unknown, handler: Handler) => routes.set(path, handler),
    addHook() {},
  };
  return { stub, routes, warnings };
};

class FakeSocket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  sent: string[] = [];
  terminated = 0;
  send(message: string) {
    this.sent.push(message);
  }
  terminate() {
    this.terminated += 1;
    this.readyState = 3;
  }
}

const connectTelemetryClient = async (bufferedAmount: number) => {
  const { stub, routes, warnings } = createFastifyStub();
  await (rosGateway as any)(stub, {});
  const manager = new EventEmitter() as any;
  manager.getLatestChannelEvents = () => [];
  stub.rosRegistry.getManager = () => manager;

  const socket = new FakeSocket();
  socket.bufferedAmount = bufferedAmount;
  const handler = routes.get('/ws/robots/:robotId/telemetry/:label');
  if (!handler) throw new Error('telemetry route not registered');
  handler(socket, { params: { robotId: 'r1' } });
  return { manager, socket, warnings };
};

test('forwards telemetry while the client keeps up', async () => {
  const { manager, socket } = await connectTelemetryClient(0);

  manager.emit('channel-data', { channel: 'odom', data: { x: 1 } });

  expect(socket.sent).toEqual([JSON.stringify({ type: 'event', channel: 'odom', data: { x: 1 } })]);
  expect(socket.terminated).toBe(0);
});

test('terminates a client whose send buffer has piled up', async () => {
  const { manager, socket, warnings } = await connectTelemetryClient(8 * 1024 * 1024);

  manager.emit('channel-data', { channel: 'odom', data: { x: 1 } });
  manager.emit('channel-data', { channel: 'odom', data: { x: 2 } });

  expect(socket.sent).toEqual([]);
  expect(socket.terminated).toBe(1);
  expect(warnings.some(w => (w as any)?.robotId === 'r1')).toBe(true);
});
