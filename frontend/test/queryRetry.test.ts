import { expect, test } from 'bun:test';
import { HTTPError, type NormalizedOptions, TimeoutError } from 'ky';
import { queryClient } from '../src/lib/query-client';

const retry = queryClient.getDefaultOptions().queries?.retry as (
  failureCount: number,
  error: unknown
) => boolean;

const request = new Request('http://api.test/robots');
const httpError = (status: number) =>
  new HTTPError(new Response(null, { status }), request, {} as NormalizedOptions);

test('a query refused with a 4xx fails at once', () => {
  for (const status of [400, 401, 403, 404, 409]) {
    expect(retry(0, httpError(status))).toBe(false);
  }
});

test('timeouts, rate limits and server errors are retried twice', () => {
  for (const error of [
    httpError(408),
    httpError(429),
    httpError(500),
    new TimeoutError(request),
    new TypeError('Failed to fetch'),
  ]) {
    expect(retry(0, error)).toBe(true);
    expect(retry(1, error)).toBe(true);
    expect(retry(2, error)).toBe(false);
  }
});
