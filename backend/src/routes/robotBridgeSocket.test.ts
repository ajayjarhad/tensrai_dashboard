import { afterEach, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { RosRegistry } from '../services/rosRegistry.js';

const { createRobotBridgeHandler } = await import('./robotBridgeSocket.js');

class FakeSocket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  sent: string[] = [];
  send(message: string) {
    this.sent.push(message);
  }
  close() {
    this.emit('close');
  }
}

class FakeManager extends EventEmitter {
  commands: unknown[] = [];
  constructor(private readonly result: object) {
    super();
  }
  getLatestChannelEvents() {
    return [];
  }
  handleCommand(channel: string, data: unknown) {
    this.commands.push([channel, data]);
    return this.result;
  }
}

const sockets: FakeSocket[] = [];

afterEach(() => {
  while (sockets.length > 0) sockets.pop()?.close();
});

const connect = (manager: FakeManager | undefined) => {
  const logs: unknown[][] = [];
  const record =
    (level: string) =>
    (...args: unknown[]) =>
      logs.push([level, ...args]);
  const fastify = { log: { info: record('info'), warn: record('warn'), error: record('error') } };
  const registry = { getManager: () => manager, onManagerChange: () => () => {} };
  // Only the members the handler reads are faked.
  const handle = createRobotBridgeHandler(
    fastify as unknown as FastifyInstance,
    registry as unknown as RosRegistry
  );
  const socket = new FakeSocket();
  sockets.push(socket);
  handle(socket, { params: { robotId: 'r1' } } as unknown as FastifyRequest);
  const send = (message: unknown) =>
    socket.emit(
      'message',
      Buffer.from(typeof message === 'string' ? message : JSON.stringify(message))
    );
  const frames = () => socket.sent.map(message => JSON.parse(message));
  return { logs, send, frames };
};

test('a stale teleop command is logged as a warning when received and when published', () => {
  const manager = new FakeManager({ ok: true, topic: '/cmd_vel' });
  const { logs, send, frames } = connect(manager);
  const sentAtMs = Date.now() - 5_000;

  send({ type: 'command', channel: 'teleop', commandId: 'c1', sentAtMs, data: { linear: 0.1 } });

  expect(manager.commands).toEqual([['teleop', { linear: 0.1 }]]);
  expect(logs).toEqual([
    [
      'warn',
      {
        robotId: 'r1',
        channel: 'teleop',
        commandId: 'c1',
        sentAtMs,
        ageMs: expect.any(Number),
        reason: 'teleop_command_age_high',
        managerAttached: true,
        stage: 'received',
      },
      'ROS bridge command received',
    ],
    [
      'warn',
      {
        robotId: 'r1',
        channel: 'teleop',
        commandId: 'c1',
        reason: 'teleop_command_age_high',
        result: { ok: true, topic: '/cmd_vel' },
        stage: 'published',
      },
      'ROS bridge command published',
    ],
  ]);
  expect(Object.keys((logs[0] as [string, object])[1])).toEqual([
    'robotId',
    'channel',
    'commandId',
    'sentAtMs',
    'ageMs',
    'reason',
    'managerAttached',
    'stage',
  ]);
  expect(frames()).toEqual([]);
});

test('a command without a send time is logged at info, with no age or reason', () => {
  const manager = new FakeManager({ ok: true });
  const { logs, send } = connect(manager);

  send({ type: 'command', channel: 'goal', data: { x: 1 } });

  expect(logs).toEqual([
    [
      'info',
      {
        robotId: 'r1',
        channel: 'goal',
        commandId: null,
        sentAtMs: null,
        ageMs: null,
        managerAttached: true,
        stage: 'received',
      },
      'ROS bridge command received',
    ],
    [
      'info',
      { robotId: 'r1', channel: 'goal', commandId: null, result: { ok: true }, stage: 'published' },
      'ROS bridge command published',
    ],
  ]);
});

test('a command for a robot with no manager is rejected and the client is told why', () => {
  const { logs, send, frames } = connect(undefined);

  send({ type: 'command', channel: 'goal', commandId: 'c2', data: {} });

  expect(logs[1]).toEqual([
    'warn',
    {
      robotId: 'r1',
      channel: 'goal',
      commandId: 'c2',
      reason: 'robot_not_found',
      stage: 'rejected',
    },
    'ROS bridge command rejected',
  ]);
  expect(frames()).toEqual([
    { type: 'error', channel: 'goal', requestId: 'c2', message: 'Unknown robot: r1' },
  ]);
});

test('a command the manager refuses is rejected with the manager’s reason', () => {
  const refusal = { ok: false, error: 'Unknown channel: nope', channelName: 'nope' };
  const { logs, send, frames } = connect(new FakeManager(refusal));

  send({ type: 'command', channel: 'nope', commandId: 'c3', data: {} });

  expect(logs[1]).toEqual([
    'warn',
    {
      robotId: 'r1',
      channel: 'nope',
      commandId: 'c3',
      error: 'Unknown channel: nope',
      result: refusal,
      stage: 'rejected',
    },
    'ROS bridge command rejected',
  ]);
  expect(frames()).toEqual([
    { type: 'error', channel: 'nope', requestId: 'c3', message: 'Unknown channel: nope' },
  ]);
});

test('a refusal without a reason is reported as a failed command', () => {
  const { logs, send, frames } = connect(new FakeManager({ ok: false }));

  send({ type: 'command', channel: 'goal', data: {} });

  expect(logs[1]?.[1]).toMatchObject({ error: 'Command failed', stage: 'rejected' });
  expect(frames()).toEqual([{ type: 'error', channel: 'goal', message: 'Command failed' }]);
});

test('malformed, asset and unknown frames each get an error back', () => {
  const { send, frames } = connect(new FakeManager({ ok: true }));

  send('{not json');
  send({ type: 'request', channel: 'asset', requestId: 'q1', data: { asset: 'map' } });
  send({ type: 'subscribe', channel: 'odom' });

  expect(frames()).toEqual([
    { type: 'error', message: 'Invalid JSON message' },
    {
      type: 'error',
      channel: 'asset',
      requestId: 'q1',
      message: 'Asset channel disabled; use HTTP or enable later',
    },
    { type: 'error', message: 'Unsupported message type' },
  ]);
});
