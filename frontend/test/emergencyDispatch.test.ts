import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { useRobotEmergencyStore } from '@/stores/robotEmergency';

class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeSocket[] = [];

  readyState = FakeSocket.CONNECTING;
  sent: string[] = [];
  closeCalls = 0;
  acknowledges = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }

  // A robot that acknowledges at once lets the dispatch settle without polling.
  send(payload: string) {
    this.sent.push(payload);
    if (!this.acknowledges) return;
    const { status } = (JSON.parse(payload) as { payload: { status: boolean } }).payload;
    this.onmessage?.({
      data: JSON.stringify({ event: 'SOFTWARE_EMERGENCY_ACK', payload: { status } }),
    });
  }

  close() {
    this.closeCalls += 1;
    this.readyState = FakeSocket.CLOSING;
  }

  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
}

const socketAt = (index: number) => {
  const socket = FakeSocket.instances[index];
  if (!socket) throw new Error(`no socket ${index}`);
  return socket;
};

const alpha = { id: 'r1', name: 'Alpha' };
const bravo = { id: 'r2', name: 'Bravo' };
const store = () => useRobotEmergencyStore.getState();

const originals = {
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  WebSocket: globalThis.WebSocket,
};

beforeEach(() => {
  FakeSocket.instances = [];
  Object.assign(globalThis, {
    WebSocket: FakeSocket,
    setTimeout: () => 0,
    clearTimeout: () => {},
  });
});

afterEach(() => {
  store().disconnectAll();
  Object.assign(globalThis, originals);
});

describe('syncing the fleet', () => {
  test('a robot keeps its socket across syncs, and a removed robot is disconnected', () => {
    store().syncRobots([alpha, bravo]);
    store().syncRobots([alpha, bravo]);
    expect(FakeSocket.instances).toHaveLength(2);

    store().syncRobots([alpha]);

    expect(socketAt(0).closeCalls).toBe(0);
    expect(socketAt(1).closeCalls).toBe(1);
    expect(store().byRobot['r1']).toMatchObject({
      robotName: 'Alpha',
      connectionStatus: 'connecting',
      effectiveEmergencyActive: false,
    });
  });
});

describe('a fleet software e-stop', () => {
  test('a removed robot leaves the store, so a fleet e-stop is not sent to it', async () => {
    store().syncRobots([alpha, bravo]);
    socketAt(0).acknowledges = true;
    socketAt(0).open();
    store().syncRobots([alpha]);

    expect(store().byRobot['r2']).toBeUndefined();
    const result = await store().sendFleetSoftwareEmergency(true);
    expect(result.status).toBe('success');
    expect(result.results.map(entry => entry.robotId)).toEqual(['r1']);
  });

  test('one robot acknowledging while another is still connecting is a partial failure', async () => {
    store().syncRobots([alpha, bravo]);
    socketAt(0).acknowledges = true;
    socketAt(0).open();

    const result = await store().sendFleetSoftwareEmergency(true);

    expect(JSON.parse(socketAt(0).sent[0] as string)).toEqual({
      type: 'SOFTWARE_EMERGENCY',
      payload: { status: true },
    });
    expect(socketAt(1).sent).toEqual([]);
    expect(result.status).toBe('partial_failure');
    expect(result.results).toEqual([
      {
        robotId: 'r1',
        robotName: 'Alpha',
        applied: true,
        connectionStatus: 'connected',
        softwareEmergencyActive: true,
        hardwareEmergencyActive: false,
        effectiveEmergencyActive: true,
        error: null,
      },
      {
        robotId: 'r2',
        robotName: 'Bravo',
        applied: false,
        connectionStatus: 'connecting',
        softwareEmergencyActive: false,
        hardwareEmergencyActive: false,
        effectiveEmergencyActive: false,
        error: 'Emergency bridge not connected',
      },
    ]);
    expect(store().pendingDispatch).toBeNull();
    expect(store().lastDispatchResult).toBe(result);
  });

  test('a robot without a bridge fails at once and the dispatch fails', async () => {
    useRobotEmergencyStore.setState({
      byRobot: {
        r3: {
          robotId: 'r3',
          softwareEmergencyActive: false,
          hardwareEmergencyActive: false,
          effectiveEmergencyActive: false,
          connectionStatus: 'unconfigured',
          source: 'unknown',
        },
      },
    });

    const result = await store().sendFleetSoftwareEmergency(false);

    expect(result.status).toBe('failure');
    expect(result.results).toEqual([
      {
        robotId: 'r3',
        applied: false,
        connectionStatus: 'unconfigured',
        softwareEmergencyActive: false,
        hardwareEmergencyActive: false,
        effectiveEmergencyActive: false,
        error: 'Emergency bridge not configured',
      },
    ]);
  });

  test('a dispatch to an empty fleet succeeds', async () => {
    const result = await store().sendFleetSoftwareEmergency(true);

    expect(result.status).toBe('success');
    expect(result.results).toEqual([]);
  });
});
