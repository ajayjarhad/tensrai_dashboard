import { expect, test } from 'bun:test';
import { appLinks } from '../src/components/AppNav';
import { signedInGate } from '../src/router/signedInGate';
import { useAuthStore } from '../src/stores/auth';

const linksFor = (role: string) => {
  useAuthStore.setState({
    user: {
      id: role,
      orgId: 'org',
      username: role,
      email: `${role}@example.test`,
      role,
      isActive: true,
    },
    isAuthenticated: true,
  } as never);
  return appLinks(useAuthStore.getState().hasPermission).map(link => link.to);
};

test('a member sees the dashboard and maps', () => {
  expect(linksFor('USER')).toEqual(['/', '/maps']);
});

test('an org admin also gets robots and users, but not organizations', () => {
  expect(linksFor('ADMIN')).toEqual(['/', '/maps', '/admin/robots', '/admin/users']);
});

test('staff get every page', () => {
  expect(linksFor('STAFF')).toEqual(['/', '/maps', '/admin/robots', '/admin/users', '/staff']);
});

const signedIn = {
  hasHydrated: true,
  isLoading: false,
  isAuthenticated: true,
  mustResetPassword: false,
};

test('the app waits until the session is restored', () => {
  expect(signedInGate({ ...signedIn, hasHydrated: false })).toBe('loading');
  expect(signedInGate({ ...signedIn, isLoading: true })).toBe('loading');
});

test('a visitor without a session goes to sign-in', () => {
  expect(signedInGate({ ...signedIn, isAuthenticated: false })).toBe('login');
});

test('an account that must set its password goes there before the app', () => {
  expect(signedInGate({ ...signedIn, mustResetPassword: true })).toBe('password-reset');
});

test('a signed-in user gets the app', () => {
  expect(signedInGate(signedIn)).toBe('app');
});
