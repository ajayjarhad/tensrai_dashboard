import { afterEach, beforeEach, expect, test } from 'bun:test';
import { apiClient } from '../src/lib/api';
import { revalidateSession, useAuthStore } from '../src/stores/auth';

const signedInUser = {
  id: 'u1',
  orgId: 'org-a',
  orgName: 'Old name',
  username: 'operator',
  email: 'operator@example.com',
  role: 'USER',
  isActive: true,
  mustResetPassword: false,
} as any;

const realFetch = globalThis.fetch;

const respondWith = (status: number, body: object) => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
};

beforeEach(() => {
  useAuthStore.setState({ user: signedInUser, isAuthenticated: true, session: {} as any });
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const request = (path: string) => apiClient.get(path).catch(() => {});
const signedIn = () => useAuthStore.getState().isAuthenticated;

test('a rejected session signs the dashboard out instead of showing an empty fleet', async () => {
  respondWith(401, { code: 'AUTH_REQUIRED' });
  await request('robots');
  expect(signedIn()).toBe(false);
  expect(useAuthStore.getState().user).toBeNull();
});

test('a disabled account or a missing organization also signs out', async () => {
  for (const code of ['ACCOUNT_DISABLED', 'NO_ORGANIZATION']) {
    useAuthStore.setState({ user: signedInUser, isAuthenticated: true });
    respondWith(403, { code });
    await request('robots');
    expect([code, signedIn()]).toEqual([code, false]);
  }
});

test('being refused one action is not being signed out', async () => {
  respondWith(403, { code: 'INSUFFICIENT_PERMISSIONS' });
  await request('users');
  expect(signedIn()).toBe(true);

  respondWith(404, { code: 'ROBOT_NOT_FOUND' });
  await request('robots/r1');
  expect(signedIn()).toBe(true);
});

test('a 401 from the auth routes only means "not signed in", so it never signs anyone out', async () => {
  respondWith(401, {});
  await request('auth/session');
  expect(signedIn()).toBe(true);
});

test('a pending password setup marks the saved user, so the setup page keeps them', async () => {
  respondWith(428, { code: 'PASSWORD_SETUP_REQUIRED' });
  await request('robots');
  expect(signedIn()).toBe(true);
  expect(useAuthStore.getState().user?.mustResetPassword).toBe(true);
});

test('revalidating refreshes the saved user', async () => {
  respondWith(200, {
    user: { ...signedInUser, orgName: 'New name' },
    session: { sessionId: 's1' },
  });
  await revalidateSession();
  expect(signedIn()).toBe(true);
  expect(useAuthStore.getState().user?.orgName).toBe('New name');
});

test('revalidating signs out when the server says there is no session', async () => {
  respondWith(401, { code: 'NO_SESSION' });
  await revalidateSession();
  expect(signedIn()).toBe(false);
});

test('a server or network problem while revalidating does not sign anyone out', async () => {
  respondWith(500, {});
  await revalidateSession();
  expect(signedIn()).toBe(true);

  globalThis.fetch = (async () => {
    throw new TypeError('network down');
  }) as typeof fetch;
  await revalidateSession();
  expect(signedIn()).toBe(true);
});
