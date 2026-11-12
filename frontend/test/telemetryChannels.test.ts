import { afterEach, beforeEach, expect, setSystemTime, test } from 'bun:test';
import { useRobotTelemetryStore } from '@/stores/robotTelemetry';

class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static last: FakeSocket | null = null;

  readyState = FakeSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(public url: string) {
    FakeSocket.last = this;
  }

  send() {}

  close() {
    this.readyState = FakeSocket.CLOSING;
  }

  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
}

const T0 = Date.parse('2026-11-08T10:00:00.000Z');
let elapsedMs = 0;

// Each frame arrives a second after the last, so no channel is throttled.
const frame = (channel: string, data: unknown) => {
  elapsedMs += 1000;
  setSystemTime(new Date(T0 + elapsedMs));
  FakeSocket.last?.onmessage?.({ data: JSON.stringify({ type: 'event', channel, data }) });
};

const robot = () => useRobotTelemetryStore.getState().telemetry['r1'];

const scan = {
  angle_min: 0,
  angle_max: 1,
  angle_increment: 0.5,
  range_min: 0.1,
  range_max: 10,
  ranges: [1, 2],
};

const originals = {
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  WebSocket: globalThis.WebSocket,
  log: console.log,
  info: console.info,
};

beforeEach(() => {
  elapsedMs = 0;
  setSystemTime(new Date(T0));
  console.log = () => {};
  console.info = () => {};
  Object.assign(globalThis, {
    WebSocket: FakeSocket,
    setTimeout: () => 0,
    clearTimeout: () => {},
  });
  useRobotTelemetryStore.getState().connect('r1');
  FakeSocket.last?.open();
});

afterEach(() => {
  useRobotTelemetryStore.getState().disconnect('r1');
  setSystemTime();
  console.log = originals.log;
  console.info = originals.info;
  Object.assign(globalThis, {
    WebSocket: originals.WebSocket,
    setTimeout: originals.setTimeout,
    clearTimeout: originals.clearTimeout,
  });
});

test('odom, pose and amcl frames set their poses, and frames that cannot be read are ignored', () => {
  frame('odom', { nope: true });
  frame('pose', { x: 'not a number', y: 1 });
  frame('amcl', { pose: {} });
  expect(robot()).toMatchObject({ status: 'connected' });
  expect(robot()?.odomPose).toBeUndefined();
  expect(robot()?.tfPose).toBeUndefined();
  expect(robot()?.amclPose).toBeUndefined();

  frame('odom', { pose: { pose: { position: { x: 1, y: 2 }, orientation: { w: 1 } } } });
  frame('amcl', { pose: { pose: { position: { x: 5, y: 6 }, orientation: { w: 1 } } } });
  frame('pose', { x: 3, y: 4, yaw: 0.5 });

  expect(robot()).toMatchObject({
    odomPose: { x: 1, y: 2, theta: 0 },
    amclPose: { x: 5, y: 6, theta: 0 },
    tfPose: { x: 3, y: 4, theta: 0.5 },
    lastOdomAt: T0 + 4000,
    lastAmclAt: T0 + 5000,
    lastTfAt: T0 + 6000,
  });
});

test('a laser frame keeps its scan pose only while that pose is finite', () => {
  frame('laser', { ...scan, scanPose: { x: 1, y: 1, theta: 0 } });
  expect(robot()?.laserPose).toEqual({ x: 1, y: 1, theta: 0 });

  frame('laser', { ...scan, scanPose: { x: 1, y: null, theta: 0 } });
  expect(robot()?.laser?.ranges).toEqual([1, 2]);
  expect(robot()?.lastLaserAt).toBe(T0 + 2000);
  expect(robot()).not.toHaveProperty('laserPose');
});

test('a waypoints frame becomes the path', () => {
  const path = { poses: [{ pose: { position: { x: 1, y: 2 } } }] };
  frame('waypoints', path);

  expect(robot()).toMatchObject({ path, lastPathAt: T0 + 1000 });
});
