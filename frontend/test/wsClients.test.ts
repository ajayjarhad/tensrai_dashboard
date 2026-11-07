import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createRobotEmergencyWsClient } from '../src/services/robotEmergencyWsClient';
import { createRobotMappingWsClient } from '../src/services/robotMappingWsClient';
import { createRobotWsClient } from '../src/services/robotWsClient';

class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeSocket[] = [];
  static constructorError: Error | null = null;

  readyState = FakeSocket.CONNECTING;
  bufferedAmount = 0;
  sent: string[] = [];
  closeCalls = 0;
  failNextSends = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(public url: string) {
    if (FakeSocket.constructorError) throw FakeSocket.constructorError;
    FakeSocket.instances.push(this);
  }

  send(payload: string) {
    if (this.failNextSends > 0) {
      this.failNextSends -= 1;
      throw new Error('send failed');
    }
    this.sent.push(payload);
  }

  close() {
    this.closeCalls += 1;
    this.readyState = FakeSocket.CLOSING;
  }

  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }

  drop() {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }
}

const sockets = () => FakeSocket.instances;
const lastSocket = () => {
  const socket = FakeSocket.instances.at(-1);
  if (!socket) throw new Error('no socket was created');
  return socket;
};

let clock = 0;
let nextTimerId = 1;
const timers = new Map<number, { at: number; run: () => void }>();

const advance = (ms: number) => {
  const target = clock + ms;
  while (true) {
    const due = [...timers.entries()]
      .filter(([, timer]) => timer.at <= target)
      .sort(([, a], [, b]) => a.at - b.at)[0];
    if (!due) break;
    timers.delete(due[0]);
    clock = due[1].at;
    due[1].run();
  }
  clock = target;
};

const originals = {
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  WebSocket: globalThis.WebSocket,
  consoleInfo: console.info,
};

beforeEach(() => {
  clock = 0;
  timers.clear();
  FakeSocket.instances = [];
  FakeSocket.constructorError = null;
  console.info = () => {};
  Object.assign(globalThis, {
    WebSocket: FakeSocket,
    setTimeout: (run: () => void, ms: number) => {
      nextTimerId += 1;
      timers.set(nextTimerId, { at: clock + ms, run });
      return nextTimerId;
    },
    clearTimeout: (id: number) => {
      timers.delete(id);
    },
  });
});

afterEach(() => {
  Object.assign(globalThis, {
    WebSocket: originals.WebSocket,
    setTimeout: originals.setTimeout,
    clearTimeout: originals.clearTimeout,
  });
  console.info = originals.consoleInfo;
});

type StatusClient = {
  connect: () => void;
  disconnect: () => void;
  addStatusListener: (handler: (status: never) => void) => () => unknown;
  getStatus: () => string;
};

const watchStatus = (client: StatusClient) => {
  const seen: string[] = [];
  client.addStatusListener(((status: string) => seen.push(status)) as (status: never) => void);
  return seen;
};

const clientFactories: Record<string, () => StatusClient> = {
  telemetry: () => createRobotWsClient('r1'),
  mission: () => createRobotMappingWsClient('r1'),
  emergency: () => createRobotEmergencyWsClient({ robotId: 'r1' }),
};

for (const [name, create] of Object.entries(clientFactories)) {
  describe(`${name} connection`, () => {
    test('a new listener hears the current status, then every change', () => {
      const client = create();
      const seen = watchStatus(client);

      client.connect();
      lastSocket().open();

      expect(seen).toEqual(['disconnected', 'connecting', 'connected']);
      expect(client.getStatus()).toBe('connected');
    });

    test('connecting again while connecting or open reuses the socket', () => {
      const client = create();

      client.connect();
      client.connect();
      expect(sockets()).toHaveLength(1);

      lastSocket().open();
      client.connect();
      expect(sockets()).toHaveLength(1);
    });

    test('reconnects back off to ten seconds and reset after a successful open', () => {
      const client = create();
      client.connect();

      for (const delay of [1000, 2000, 4000, 8000, 10_000, 10_000]) {
        const before = sockets().length;
        lastSocket().drop();
        advance(delay - 1);
        expect(sockets()).toHaveLength(before);
        advance(1);
        expect(sockets()).toHaveLength(before + 1);
      }

      lastSocket().open();
      lastSocket().drop();
      advance(1000);
      expect(lastSocket().readyState).toBe(FakeSocket.CONNECTING);
    });

    test('a socket still connecting after eight seconds errors and is closed', () => {
      const client = create();
      const seen = watchStatus(client);
      client.connect();

      advance(7999);
      expect(lastSocket().closeCalls).toBe(0);
      advance(1);

      expect(seen.at(-1)).toBe('error');
      expect(lastSocket().closeCalls).toBe(1);

      lastSocket().drop();
      expect(seen.at(-1)).toBe('disconnected');
      advance(1000);
      expect(sockets()).toHaveLength(2);
    });

    test('opening in time cancels the connect timeout', () => {
      const client = create();
      client.connect();
      lastSocket().open();

      advance(60_000);

      expect(lastSocket().closeCalls).toBe(0);
      expect(client.getStatus()).toBe('connected');
    });

    test('a socket error reports error without reconnecting until it closes', () => {
      const client = create();
      const seen = watchStatus(client);
      client.connect();
      lastSocket().open();

      lastSocket().onerror?.();
      advance(60_000);

      expect(seen.at(-1)).toBe('error');
      expect(sockets()).toHaveLength(1);
    });

    test('disconnect closes the socket and stops reconnecting', () => {
      const client = create();
      const seen = watchStatus(client);
      client.connect();
      const socket = lastSocket();
      socket.open();

      client.disconnect();
      expect(socket.closeCalls).toBe(1);
      expect(seen.at(-1)).toBe('disconnected');
      const heard = seen.length;

      socket.drop();
      advance(60_000);
      expect(sockets()).toHaveLength(1);
      expect(seen).toHaveLength(heard);
    });

    test('disconnect cancels a pending reconnect, and connect starts over', () => {
      const client = create();
      client.connect();
      lastSocket().drop();

      client.disconnect();
      advance(60_000);
      expect(sockets()).toHaveLength(1);

      client.connect();
      expect(sockets()).toHaveLength(2);
    });

    test('a removed status listener stops hearing changes', () => {
      const client = create();
      const seen: string[] = [];
      const remove = client.addStatusListener(((status: string) => seen.push(status)) as (
        status: never
      ) => void);

      remove();
      client.connect();

      expect(seen).toEqual(['disconnected']);
    });
  });
}

describe('telemetry commands', () => {
  const buffered = ['mode', 'initialpose', 'emergency'];

  test('an open socket sends the command frame straight away', () => {
    const client = createRobotWsClient('r1');
    client.connect();
    lastSocket().open();

    const result = client.sendCommand('teleop', { speed: 1 });

    expect(result.status).toBe('sent');
    const frame = JSON.parse(lastSocket().sent[0] as string);
    expect(frame).toMatchObject({
      type: 'command',
      channel: 'teleop',
      commandId: result.commandId,
      data: { speed: 1 },
    });
    expect(typeof frame.sentAtMs).toBe('number');
  });

  test('teleop is dropped when it cannot go now, because stale motion must not replay', () => {
    const client = createRobotWsClient('r1');

    expect(client.sendCommand('teleop', {})).toMatchObject({
      status: 'dropped',
      reason: 'socket_not_ready',
    });
    expect(sockets()).toHaveLength(1);

    expect(client.sendCommand('teleop', {})).toMatchObject({
      status: 'dropped',
      reason: 'socket_connecting',
    });

    lastSocket().open();
    lastSocket().failNextSends = 1;
    expect(client.sendCommand('teleop', {})).toMatchObject({
      status: 'dropped',
      reason: 'send_failed',
    });

    lastSocket().readyState = FakeSocket.CLOSED;
    expect(client.sendCommand('teleop', {})).toMatchObject({
      status: 'dropped',
      reason: 'socket_not_open',
    });
    expect(sockets()).toHaveLength(2);

    lastSocket().open();
    expect(lastSocket().sent).toEqual([]);
  });

  for (const channel of buffered) {
    test(`${channel} waits for the socket and is sent on open, in order`, () => {
      const client = createRobotWsClient('r1');

      const first = client.sendCommand(channel, { n: 1 });
      const second = client.sendCommand(channel, { n: 2 });
      expect(first.status).toBe('queued');
      expect(second.status).toBe('queued');
      expect(first.commandId).toBeTruthy();

      lastSocket().open();

      expect(lastSocket().sent.map(frame => JSON.parse(frame).data.n)).toEqual([1, 2]);
    });
  }

  test('a failed send of a buffered command retries on the next open', () => {
    const client = createRobotWsClient('r1');
    client.connect();
    lastSocket().open();
    lastSocket().failNextSends = 1;

    expect(client.sendCommand('emergency', { n: 1 }).status).toBe('queued');

    lastSocket().drop();
    advance(1000);
    lastSocket().open();
    expect(JSON.parse(lastSocket().sent[0] as string).data.n).toBe(1);
  });

  test('the queue keeps the newest hundred commands', () => {
    const client = createRobotWsClient('r1');
    for (let n = 0; n < 105; n += 1) client.sendCommand('mode', { n });

    lastSocket().open();

    const sent = lastSocket().sent.map(frame => JSON.parse(frame).data.n);
    expect(sent).toHaveLength(100);
    expect(sent[0]).toBe(5);
    expect(sent.at(-1)).toBe(104);
  });

  test('a send failing during flush reports error and keeps the rest in order', () => {
    const client = createRobotWsClient('r1');
    const seen = watchStatus(client);
    client.sendCommand('mode', { n: 1 });
    client.sendCommand('mode', { n: 2 });
    lastSocket().failNextSends = 1;

    lastSocket().open();
    expect(seen.at(-1)).toBe('error');
    expect(lastSocket().sent).toEqual([]);

    lastSocket().drop();
    advance(1000);
    lastSocket().open();
    expect(lastSocket().sent.map(frame => JSON.parse(frame).data.n)).toEqual([1, 2]);
  });

  test('disconnect drops the queue and refuses further commands', () => {
    const client = createRobotWsClient('r1');
    client.sendCommand('mode', { n: 1 });

    client.disconnect();
    expect(client.sendCommand('mode', { n: 2 })).toMatchObject({
      status: 'dropped',
      reason: 'client_disconnected',
    });

    client.connect();
    lastSocket().open();
    expect(lastSocket().sent).toEqual([]);
  });

  test('events reach listeners only while connected, and bad frames are ignored', () => {
    const client = createRobotWsClient('r1');
    const events: unknown[] = [];
    client.addEventListener(event => events.push(event));
    client.connect();
    const frame = { type: 'event', channel: 'odom', data: { x: 1 } };

    lastSocket().onmessage?.({ data: JSON.stringify(frame) });
    expect(events).toEqual([]);

    lastSocket().open();
    lastSocket().onmessage?.({ data: 'not json' });
    lastSocket().onmessage?.({ data: JSON.stringify(frame) });
    expect(events).toEqual([frame]);
  });

  test('a listener that throws does not break the socket', () => {
    const client = createRobotWsClient('r1');
    const events: unknown[] = [];
    client.addEventListener(() => {
      throw new Error('listener failed');
    });
    client.connect();
    lastSocket().open();

    expect(() => lastSocket().onmessage?.({ data: '{"type":"event"}' })).not.toThrow();
    const remove = client.addEventListener(event => events.push(event));
    remove();
    lastSocket().onmessage?.({ data: '{"type":"event"}' });
    expect(events).toEqual([]);
  });

  test('connects to the telemetry path for the robot', () => {
    createRobotWsClient('r1').connect();

    expect(lastSocket().url).toEndWith('/ws/robots/r1/telemetry/telemetry-r1');
  });
});

describe('mission commands', () => {
  test('an open socket sends the event with a command id', () => {
    const client = createRobotMappingWsClient('r1');
    client.connect();
    lastSocket().open();

    const result = client.sendEvent('START_MISSION', { missionId: 'm1' });

    expect(result).toMatchObject({ accepted: true, queued: false });
    expect(JSON.parse(lastSocket().sent[0] as string)).toEqual({
      type: 'command',
      event: 'START_MISSION',
      commandId: result.commandId,
      payload: { missionId: 'm1', requestId: result.commandId },
    });
  });

  test('a request id in the payload becomes the command id', () => {
    const result = createRobotMappingWsClient('r1').sendEvent('SHOW_UP', { requestId: 'req-1' });

    expect(result.commandId).toBe('req-1');
  });

  test('every send that cannot go now is queued for the next open', () => {
    const client = createRobotMappingWsClient('r1');

    expect(client.sendEvent('A')).toMatchObject({ accepted: true, queued: true });
    expect(sockets()).toHaveLength(1);
    expect(client.sendEvent('B')).toMatchObject({ accepted: true, queued: true });

    lastSocket().open();
    lastSocket().failNextSends = 1;
    expect(client.sendEvent('C')).toMatchObject({ accepted: true, queued: true });

    lastSocket().readyState = FakeSocket.CLOSED;
    expect(client.sendEvent('D')).toMatchObject({ accepted: true, queued: true });
    expect(sockets()).toHaveLength(2);

    lastSocket().open();
    expect(lastSocket().sent.map(frame => JSON.parse(frame).event)).toEqual(['C', 'D']);
    expect(sockets()[0]?.sent.map(frame => JSON.parse(frame).event)).toEqual(['A', 'B']);
  });

  test('the queue keeps the newest hundred events', () => {
    const client = createRobotMappingWsClient('r1');
    for (let n = 0; n < 105; n += 1) client.sendEvent(`E${n}`);

    lastSocket().open();

    expect(lastSocket().sent).toHaveLength(100);
    expect(JSON.parse(lastSocket().sent[0] as string).event).toBe('E5');
  });

  test('disconnect drops the queue and refuses further events', () => {
    const client = createRobotMappingWsClient('r1');
    client.sendEvent('A');

    client.disconnect();
    expect(client.sendEvent('B')).toMatchObject({
      accepted: false,
      queued: false,
      reason: 'client_disconnected',
    });

    client.connect();
    lastSocket().open();
    expect(lastSocket().sent).toEqual([]);
  });

  test('only known mission events reach listeners, and only while connected', () => {
    const client = createRobotMappingWsClient('r1');
    const events: Array<{ event: string }> = [];
    client.addEventListener(event => events.push(event));
    client.connect();
    const frame = JSON.stringify({ event: 'WAYPOINT_ACK', payload: { index: 1 } });

    lastSocket().onmessage?.({ data: frame });
    expect(events).toEqual([]);

    lastSocket().open();
    lastSocket().onmessage?.({ data: JSON.stringify({ event: 'NOT_A_MISSION_EVENT' }) });
    lastSocket().onmessage?.({ data: '{"event":"WAYPOINT_ACK" broken' });
    lastSocket().onmessage?.({ data: new Blob(['{}']) });
    lastSocket().onmessage?.({ data: frame });

    expect(events).toEqual([{ event: 'WAYPOINT_ACK', payload: { index: 1 } }] as never);
  });

  test('connects to the mapping path for the robot', () => {
    createRobotMappingWsClient('r1').connect();

    expect(lastSocket().url).toEndWith('/ws/robots/r1/mapping/mapping-r1');
  });
});

describe('emergency commands', () => {
  const state = {
    event: 'EMERGENCY_STATE',
    payload: {
      softwareEmergencyActive: true,
      hardwareEmergencyActive: false,
      effectiveEmergencyActive: true,
    },
  };

  test('e-stop reports false unless the socket really took the frame', () => {
    const client = createRobotEmergencyWsClient({ robotId: 'r1' });

    expect(client.sendSoftwareEmergency(true)).toBe(false);

    client.connect();
    expect(client.sendSoftwareEmergency(true)).toBe(false);
    expect(client.isOpen()).toBe(false);

    lastSocket().open();
    expect(client.isOpen()).toBe(true);
    lastSocket().failNextSends = 1;
    expect(client.sendSoftwareEmergency(true)).toBe(false);

    expect(client.sendSoftwareEmergency(true)).toBe(true);
    expect(JSON.parse(lastSocket().sent[0] as string)).toEqual({
      type: 'SOFTWARE_EMERGENCY',
      payload: { status: true },
    });
  });

  test('an unsent e-stop is never queued for later', () => {
    const client = createRobotEmergencyWsClient({ robotId: 'r1' });
    client.connect();
    client.sendSoftwareEmergency(true);

    lastSocket().open();

    expect(lastSocket().sent).toEqual([]);
  });

  test('state frames reach listeners even before the open is confirmed', () => {
    const client = createRobotEmergencyWsClient({ robotId: 'r1' });
    const events: unknown[] = [];
    client.addEventListener(event => events.push(event));
    client.connect();

    lastSocket().onmessage?.({ data: JSON.stringify(state) });
    lastSocket().onmessage?.({ data: JSON.stringify({ event: 'UNKNOWN' }) });
    lastSocket().onmessage?.({ data: 'not json' });
    lastSocket().onmessage?.({ data: new Blob(['{}']) });

    expect(events).toEqual([state]);
  });

  test('uses the backend path with the robot name as the label', () => {
    const client = createRobotEmergencyWsClient({ robotId: 'r 1', robotName: ' Alpha ' });
    client.connect();

    expect(lastSocket().url).toEndWith('/ws/robots/r%201/emergency/emergency-Alpha');
    expect(client.getUrl()).toBe(lastSocket().url);
  });

  test('a socket the browser refuses to create reports error and does not retry', () => {
    const client = createRobotEmergencyWsClient({ robotId: 'r1' });
    const seen = watchStatus(client);
    FakeSocket.constructorError = new Error('mixed content blocked');

    client.connect();
    advance(60_000);

    expect(seen).toEqual(['disconnected', 'connecting', 'error']);
    expect(sockets()).toHaveLength(0);
  });

  describe('talking directly to the robot', () => {
    const loadDirect = async () => {
      process.env['VITE_CLOUD_DASHBOARD'] = 'false';
      const { createRobotEmergencyWsClient: createDirect } = await import(
        '../src/services/robotEmergencyWsClient?direct'
      );
      delete process.env['VITE_CLOUD_DASHBOARD'];
      return createDirect as typeof createRobotEmergencyWsClient;
    };

    test('without an address it is unconfigured and creates no socket', async () => {
      const client = (await loadDirect())({ robotId: 'r1' });
      const seen = watchStatus(client);

      client.connect();
      advance(60_000);

      expect(seen).toEqual(['disconnected', 'unconfigured']);
      expect(sockets()).toHaveLength(0);
      expect(client.getUrl()).toBe('');
    });

    test('an address that makes a bad URL reports error and creates no socket', async () => {
      const client = (await loadDirect())({ robotId: 'r1', ipAddress: 'not a host' });
      const seen = watchStatus(client);

      client.connect();

      expect(seen).toEqual(['disconnected', 'error']);
      expect(sockets()).toHaveLength(0);
    });

    test('connects to the robot and uses the bridge frame shape', async () => {
      const client = (await loadDirect())({ robotId: 'r1', ipAddress: '10.0.0.5' });

      client.connect();
      expect(lastSocket().url).toEndWith('://10.0.0.5:8766/dashboard/emergency-r1');

      lastSocket().open();
      client.sendSoftwareEmergency(false);
      expect(JSON.parse(lastSocket().sent[0] as string)).toEqual({
        event: 'SOFTWARE_EMERGENCY',
        payload: { status: false },
      });
    });
  });
});
