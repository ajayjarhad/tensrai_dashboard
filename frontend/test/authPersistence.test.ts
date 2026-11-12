import { expect, test } from 'bun:test';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { authPersistOptions } from '../src/stores/auth';

const TOKEN = 'the-session-token';
const user = { id: 'u1', username: 'operator', role: 'USER', isActive: true };

// Real zustand persistence with the store's own options, over a stand-in for localStorage.
const storeWithSaved = (saved?: object) => {
  const values = new Map<string, string>();
  if (saved) values.set(authPersistOptions.name, JSON.stringify(saved));
  const store = create(
    persist(() => ({ user: null, isAuthenticated: false, session: null }) as any, {
      ...authPersistOptions,
      storage: createJSONStorage(() => ({
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => void values.set(key, value),
        removeItem: (key: string) => void values.delete(key),
      })),
    })
  );
  return { store, raw: () => values.get(authPersistOptions.name) ?? '' };
};

test('a token saved by an earlier version leaves the browser, and the user stays signed in', () => {
  const { store, raw } = storeWithSaved({
    state: {
      user,
      isAuthenticated: true,
      session: { id: 's0', token: TOKEN, sessionToken: TOKEN },
    },
    version: 0,
  });

  expect(raw()).toContain(user.id);
  expect(raw()).not.toContain(TOKEN);
  expect(JSON.stringify(store.getState())).not.toContain(TOKEN);
  expect(store.getState()).toMatchObject({ user, isAuthenticated: true });
});

test('signing in saves who signed in, and nothing about the session', () => {
  const { store, raw } = storeWithSaved();

  store.setState({
    user,
    isAuthenticated: true,
    session: { sessionId: 's1', expiresAt: '2030-01-01T00:00:00.000Z', token: TOKEN },
  });

  expect(JSON.parse(raw()).state).toEqual({ user, isAuthenticated: true });
});
