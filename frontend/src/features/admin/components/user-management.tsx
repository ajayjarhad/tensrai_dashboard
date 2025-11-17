import { wrappedApiClient } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import type { CreateUserInput, User } from '@tensrai/shared';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';

interface CreateUserResponse {
  user: User;
  tempPassword: string;
}

export function UserManagement() {
  const { user: currentUser, isAdmin } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createSuccess, setCreateSuccess] = useState<CreateUserResponse | null>(null);

  const [createFormData, setCreateFormData] = useState<CreateUserInput>({
    username: '',
    email: '',
    role: 'USER',
    displayName: '',
  });

  const loadUsers = useCallback(async () => {
    try {
      setLoading(true);
      const response = await wrappedApiClient.get<User[]>('/users');
      setUsers(response);
      setError(null);
    } catch (err) {
      setError('Failed to load users');
      console.error('Error loading users:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    loadUsers();
  }, [isAdmin, loadUsers]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const response = await wrappedApiClient.post<CreateUserResponse>('/users', createFormData);
      setCreateSuccess(response);
      setShowCreateForm(false);
      setCreateFormData({
        username: '',
        email: '',
        role: 'USER',
        displayName: '',
      });
      await loadUsers();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create user';
      setError(errorMessage);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm('Are you sure you want to delete this user?')) return;

    try {
      await wrappedApiClient.delete(`/users/${userId}`);
      await loadUsers();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete user';
      setError(errorMessage);
    }
  };

  const handleToggleUserStatus = async (userId: string, isActive: boolean) => {
    try {
      await wrappedApiClient.put(`/users/${userId}`, { isActive });
      await loadUsers();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update user';
      setError(errorMessage);
    }
  };

  if (!isAdmin) {
    return (
      <div className="text-center py-12">
        <h2 className="text-2xl font-bold text-destructive">Access Denied</h2>
        <p className="mt-2 text-muted-foreground">You don't have permission to access this page.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-foreground">User Management</h1>
        <button
          type="button"
          onClick={() => setShowCreateForm(true)}
          className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-md text-sm font-medium focus-ring"
        >
          Create User
        </button>
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded mb-4">
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-2 text-destructive hover:text-destructive/80"
          >
            ×
          </button>
        </div>
      )}

      {createSuccess && (
        <div className="bg-card border border-border px-4 py-3 rounded mb-4">
          <div className="font-medium text-foreground">User created successfully!</div>
          <div className="text-sm mt-1 text-muted-foreground">
            <strong>Username:</strong> {createSuccess.user.username}
            <br />
            <strong>Temporary Password:</strong>{' '}
            <code className="bg-muted px-1 rounded text-foreground">
              {createSuccess.tempPassword}
            </code>
          </div>
          <p className="text-xs mt-2 text-muted-foreground">
            Please share this temporary password with the user. It expires in 72 hours.
          </p>
          <button
            type="button"
            onClick={() => setCreateSuccess(null)}
            className="mt-2 text-primary hover:text-primary/80 text-sm"
          >
            Dismiss
          </button>
        </div>
      )}

      {showCreateForm && (
        <div className="fixed inset-0 bg-background/80 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border border-border w-96 shadow-lg rounded-md bg-card">
            <h3 className="text-lg font-bold text-foreground mb-4">Create New User</h3>
            <form onSubmit={handleCreateUser}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground">Username</label>
                  <input
                    type="text"
                    required
                    value={createFormData.username}
                    onChange={e =>
                      setCreateFormData(prev => ({
                        ...prev,
                        username: e.target.value,
                      }))
                    }
                    className="mt-1 block w-full px-3 py-2 border border-input rounded-md focus:outline-none focus-ring"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground">Email</label>
                  <input
                    type="email"
                    required
                    value={createFormData.email}
                    onChange={e =>
                      setCreateFormData(prev => ({
                        ...prev,
                        email: e.target.value,
                      }))
                    }
                    className="mt-1 block w-full px-3 py-2 border border-input rounded-md focus:outline-none focus-ring"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground">Display Name</label>
                  <input
                    type="text"
                    value={createFormData.displayName}
                    onChange={e =>
                      setCreateFormData(prev => ({
                        ...prev,
                        displayName: e.target.value,
                      }))
                    }
                    className="mt-1 block w-full px-3 py-2 border border-input rounded-md focus:outline-none focus-ring"
                    placeholder="Optional"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground">Role</label>
                  <select
                    value={createFormData.role}
                    onChange={e =>
                      setCreateFormData(prev => ({
                        ...prev,
                        role: e.target.value as 'ADMIN' | 'USER',
                      }))
                    }
                    className="mt-1 block w-full px-3 py-2 border border-input rounded-md focus:outline-none focus-ring"
                  >
                    <option value="USER">User</option>
                    <option value="ADMIN">Admin</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end space-x-2 mt-6">
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="px-4 py-2 text-muted-foreground border border-input rounded-md hover:bg-accent focus-ring"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 focus-ring"
                >
                  Create User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="bg-card shadow overflow-hidden sm:rounded-md">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">No users found</div>
        ) : (
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-secondary">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  User
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Role
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Created
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-background divide-y divide-border">
              {users.map(user => (
                <tr key={user.id}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <div className="text-sm font-medium text-foreground">
                        {user.displayName || user.username}
                      </div>
                      <div className="text-sm text-muted-foreground">{user.email}</div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        user.role === 'ADMIN'
                          ? 'bg-accent text-accent-foreground'
                          : 'bg-secondary text-secondary-foreground'
                      }`}
                    >
                      {user.role}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => handleToggleUserStatus(user.id, !user.isActive)}
                      className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full cursor-pointer focus-ring ${
                        user.isActive
                          ? 'bg-card text-foreground hover:bg-accent'
                          : 'bg-muted text-muted-foreground hover:bg-accent'
                      }`}
                    >
                      {user.isActive ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    {user.id !== currentUser?.id && (
                      <button
                        type="button"
                        onClick={() => handleDeleteUser(user.id)}
                        className="text-destructive hover:text-destructive/80 focus-ring"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
