import { expect, test } from 'bun:test';
import { queryClient } from '../src/lib/query-client';
import { useAuthStore } from '../src/stores/auth';

const user = (id: string) =>
  ({ id, orgId: `org-${id}`, username: id, email: `${id}@example.com`, role: 'USER' }) as any;

test('cached data is dropped when a different user signs in or the session ends', () => {
  useAuthStore.setState({ user: user('a'), isAuthenticated: true });
  queryClient.setQueryData(['robot-map', 'robots', 'list'], [{ id: 'robot-of-a' }]);

  useAuthStore.setState({ isLoading: true });
  expect(queryClient.getQueryData(['robot-map', 'robots', 'list'])).toBeDefined();

  useAuthStore.setState({ user: user('b') });
  expect(queryClient.getQueryData(['robot-map', 'robots', 'list'])).toBeUndefined();

  queryClient.setQueryData(['robot-map', 'robots', 'list'], [{ id: 'robot-of-b' }]);
  useAuthStore.setState({ user: null, isAuthenticated: false });
  expect(queryClient.getQueryData(['robot-map', 'robots', 'list'])).toBeUndefined();
});
