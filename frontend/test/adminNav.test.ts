import { expect, test } from 'bun:test';
import { adminLinks } from '../src/features/admin/components/AdminNav';
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
  return adminLinks(useAuthStore.getState().hasPermission).map(link => link.to);
};

test('a member gets no admin links', () => {
  expect(linksFor('USER')).toEqual([]);
});

test('an org admin gets users and robots, but not organizations', () => {
  expect(linksFor('ADMIN')).toEqual(['/admin/users', '/admin/robots']);
});

test('staff get all three', () => {
  expect(linksFor('STAFF')).toEqual(['/admin/users', '/admin/robots', '/staff']);
});
