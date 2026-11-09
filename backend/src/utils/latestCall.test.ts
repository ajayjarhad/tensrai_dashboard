import { expect, test } from 'bun:test';
import { LatestCall } from './latestCall.js';

test('only the most recently begun call is current', () => {
  const calls = new LatestCall();
  const first = calls.begin();
  expect(first()).toBe(true);

  const second = calls.begin();
  expect(first()).toBe(false);
  expect(second()).toBe(true);
});
