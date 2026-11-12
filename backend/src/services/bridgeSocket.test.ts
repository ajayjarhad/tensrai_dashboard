import { afterEach, beforeEach, expect, jest, test } from 'bun:test';
import EventEmitter from 'node:events';
import type WebSocket from 'ws';
import { ReconnectSchedule, startPingHeartbeat } from './bridgeSocket.js';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

const fakeSocket = (ping: () => void = () => {}) =>
  Object.assign(new EventEmitter(), { ping }) as unknown as WebSocket;

test('a pong reports when its ping went out, not when the pong arrived', () => {
  const socket = fakeSocket();
  const confirmed: number[] = [];
  const heartbeat = startPingHeartbeat(
    socket,
    1_000,
    () => {},
    sentAt => confirmed.push(sentAt)
  );

  jest.advanceTimersByTime(1_000);
  const pingSentAt = Date.now();
  jest.advanceTimersByTime(300);
  socket.emit('pong');

  expect(confirmed).toEqual([pingSentAt]);
  clearInterval(heartbeat);
});

test('an unanswered ping is reported on the next tick, and a ping that throws at once', () => {
  const reasons: string[] = [];
  const silent = startPingHeartbeat(fakeSocket(), 1_000, reason => reasons.push(reason));
  const broken = startPingHeartbeat(
    fakeSocket(() => {
      throw new Error('socket gone');
    }),
    1_000,
    reason => reasons.push(reason)
  );

  jest.advanceTimersByTime(1_000);
  expect(reasons).toEqual(['ping failed']);
  jest.advanceTimersByTime(1_000);
  expect(reasons).toContain('stopped answering pings');

  clearInterval(silent);
  clearInterval(broken);
});

test('reconnects back off to ten seconds, and an open connection starts over', () => {
  const schedule = new ReconnectSchedule();
  const delays: Array<number | undefined> = [];
  for (let i = 0; i < 6; i++) {
    delays.push(schedule.schedule('r1', () => {}));
    jest.advanceTimersByTime(10_000);
  }
  schedule.connected('r1');
  delays.push(schedule.schedule('r1', () => {}));

  expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 10_000, 10_000, 1_000]);
  schedule.cancelAll();
});

test('one reconnect at a time per robot, and a cancelled one never runs', () => {
  const schedule = new ReconnectSchedule();
  const ran: string[] = [];

  expect(schedule.schedule('r1', () => ran.push('first'))).toBe(1_000);
  expect(schedule.schedule('r1', () => ran.push('second'))).toBeUndefined();
  schedule.schedule('r2', () => ran.push('r2'));
  schedule.cancel('r2');
  jest.advanceTimersByTime(1_000);

  expect(ran).toEqual(['first']);
});
