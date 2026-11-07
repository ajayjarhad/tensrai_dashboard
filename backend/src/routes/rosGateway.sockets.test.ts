import { expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';

const { default: rosGateway } = await import('./rosGateway.js');

type Handler = (connection: unknown, request: unknown) => Promise<void>;

class FakeSocket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  sent: string[] = [];
  closed = 0;
  send(message: string) {
    this.sent.push(message);
  }
  close() {
    this.closed += 1;
  }
}

const connect = async (path: string, registries: Record<string, unknown>) => {
  const routes = new Map<string, Handler>();
  const audits: Array<{ action: string; metadata: unknown }> = [];
  const log = { info() {}, warn() {}, error() {}, debug() {} };
  const stub: any = {
    log,
    prisma: { robot: { findMany: async () => [] }, robotAddress: { findMany: async () => [] } },
    decorate: (key: string, value: unknown) => {
      stub[key] = value;
    },
    register: async () => {},
    get: (route: string, _opts: unknown, handler: Handler) => routes.set(route, handler),
    addHook() {},
    audit: async (event: { action: string; metadata: unknown }) => audits.push(event),
    ...registries,
  };
  await (rosGateway as any)(stub, {});

  const socket = new FakeSocket();
  const handler = routes.get(path);
  if (!handler) throw new Error(`route not registered: ${path}`);
  await handler(socket, {
    params: { robotId: 'r1' },
    getCurrentUser: async () => ({ id: 'u1', role: 'ADMIN' }),
  });
  return { socket, audits };
};

const frames = (socket: FakeSocket) => socket.sent.map(message => JSON.parse(message));
// Auditing looks up the user first, so it lands a tick after the frame.
const settle = () => new Promise(resolve => setImmediate(resolve));

const emergencyRegistry = (result: object = { ok: true }) => {
  const calls: unknown[] = [];
  return {
    calls,
    addRobotEventListener: () => () => {},
    getRobotSnapshotEvent: () => JSON.stringify({ event: 'EMERGENCY_STATE' }),
    sendSoftwareEmergency: (robotId: string, status: boolean) => {
      calls.push([robotId, status]);
      return result;
    },
  };
};

const EMERGENCY = '/ws/robots/:robotId/emergency';
const MISSION = '/ws/robots/:robotId/mapping';

test('an e-stop is forwarded and audited, after a snapshot on connect', async () => {
  const registry = emergencyRegistry();
  const { socket, audits } = await connect(EMERGENCY, { emergencyRegistry: registry });

  socket.emit('message', Buffer.from('{"type":"SOFTWARE_EMERGENCY","payload":{"status":true}}'));
  await settle();

  expect(frames(socket)).toEqual([{ event: 'EMERGENCY_STATE' }]);
  expect(registry.calls).toEqual([['r1', true]]);
  expect(audits.map(audit => audit.action)).toEqual(['SOFTWARE_EMERGENCY']);
});

test('a malformed e-stop reaches nothing and reports why', async () => {
  const registry = emergencyRegistry();
  const { socket } = await connect(EMERGENCY, { emergencyRegistry: registry });

  socket.emit(
    'message',
    '{"event":"SOFTWARE_EMERGENCY","payload":{"status":"on"},"requestId":"q1"}'
  );
  socket.emit('message', '{"event":"OTHER"}');
  socket.emit('message', 'not json');

  expect(registry.calls).toEqual([]);
  expect(frames(socket).slice(1)).toEqual([
    {
      type: 'error',
      requestId: 'q1',
      message: 'SOFTWARE_EMERGENCY payload.status must be boolean',
    },
    { type: 'error', message: 'Unsupported emergency websocket message' },
    { type: 'error', message: 'Invalid JSON message' },
  ]);
});

test('an e-stop the bridge refuses tells the operator', async () => {
  const registry = emergencyRegistry({ ok: false });
  const { socket } = await connect(EMERGENCY, { emergencyRegistry: registry });

  socket.emit('message', '{"event":"SOFTWARE_EMERGENCY","payload":{"status":true}}');

  expect(frames(socket).at(-1)).toEqual({
    type: 'error',
    message: 'Emergency bridge not connected',
  });
});

test('a socket with no registry is told so and closed', async () => {
  for (const [path, message] of [
    [EMERGENCY, 'Emergency registry unavailable'],
    [MISSION, 'Mission registry unavailable'],
  ] as const) {
    const { socket } = await connect(path, {});
    expect(frames(socket)).toEqual([{ type: 'error', message }]);
    expect(socket.closed).toBe(1);
  }
});

const missionRegistry = (sendResult: object = { ok: true }) => {
  const sent: string[] = [];
  const intents: unknown[][] = [];
  let unsubscribed = 0;
  let push: (text: string) => void = () => {};
  return {
    sent,
    intents,
    unsubscribedCount: () => unsubscribed,
    pushToClient: (text: string) => push(text),
    addRobotEventListener: (_robotId: string, listener: (text: string) => void) => {
      push = listener;
      return () => {
        unsubscribed += 1;
      };
    },
    sendCommand: (_robotId: string, text: string) => {
      sent.push(text);
      return sendResult;
    },
    recordCommandIntent: async (...args: unknown[]) => {
      intents.push(args);
    },
  };
};

const START = JSON.stringify({
  type: 'command',
  event: 'START_MISSION',
  commandId: 'c1',
  payload: { missionId: 'm1' },
});

test('a mission command is forwarded, recorded and audited', async () => {
  const registry = missionRegistry();
  const { socket, audits } = await connect(MISSION, { missionRegistry: registry });

  socket.emit('message', START);
  await settle();

  const forwarded = JSON.parse(registry.sent[0] as string);
  expect(forwarded.event).toBe('START_MISSION');
  expect(forwarded.payload.missionId).toBe('m1');
  expect(registry.intents).toHaveLength(1);
  expect(audits.map(audit => audit.action)).toEqual(['MISSION_COMMAND']);
  expect(socket.sent).toEqual([]);
});

test('a mission command the bridge refuses comes back as a failure ack', async () => {
  const registry = missionRegistry({ ok: false, error: 'offline' });
  const { socket } = await connect(MISSION, { missionRegistry: registry });

  socket.emit('message', START);

  const [ack] = frames(socket);
  expect(ack.commandId).toBe('c1');
  expect(ack.payload.status).toBe('failure');
  expect(ack.payload.message).toBe('offline');
  expect(registry.intents).toEqual([]);
});

test('robot events reach the client until it closes, and closing unsubscribes once', async () => {
  const registry = missionRegistry();
  const { socket } = await connect(MISSION, { missionRegistry: registry });

  registry.pushToClient('event-1');
  expect(socket.sent).toEqual(['event-1']);

  socket.emit('close');
  socket.emit('error', new Error('late'));

  expect(registry.unsubscribedCount()).toBe(1);
  expect(socket.closed).toBe(1);
});
