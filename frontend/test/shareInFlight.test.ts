import { expect, test } from 'bun:test';
import { shareInFlight } from '@/lib/utils/shareInFlight';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

test('callers that overlap share one request, and the next caller after it settles starts a new one', async () => {
  const pending = new Map<string, Promise<string>>();
  const started: string[] = [];
  const first = deferred<string>();
  const start = () => {
    started.push('m1');
    return started.length === 1 ? first.promise : Promise.resolve('fresh');
  };

  const a = shareInFlight(pending, 'm1', start);
  const b = shareInFlight(pending, 'm1', start);
  first.resolve('shared');

  expect(await Promise.all([a, b])).toEqual(['shared', 'shared']);
  expect(await shareInFlight(pending, 'm1', start)).toBe('fresh');
  expect(started).toHaveLength(2);
  expect(pending.size).toBe(0);
});

test('a failed request is shared by its callers and not kept', async () => {
  const pending = new Map<string, Promise<string>>();
  const failing = deferred<string>();
  const a = shareInFlight(pending, 'm1', () => failing.promise);
  const b = shareInFlight(pending, 'm1', () => Promise.resolve('unused'));
  failing.reject(new Error('offline'));

  await expect(a).rejects.toThrow('offline');
  await expect(b).rejects.toThrow('offline');
  expect(await shareInFlight(pending, 'm1', () => Promise.resolve('retried'))).toBe('retried');
});

test('different keys never share', async () => {
  const pending = new Map<string, Promise<string>>();
  const results = await Promise.all([
    shareInFlight(pending, 'm1', () => Promise.resolve('one')),
    shareInFlight(pending, 'm2', () => Promise.resolve('two')),
  ]);
  expect(results).toEqual(['one', 'two']);
});
