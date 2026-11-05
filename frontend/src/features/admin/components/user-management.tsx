import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/stores/auth';
import type { ResetUserPasswordResult } from '../api/resetUserPassword';
import { useDeleteUser, useResetUserPassword, useUpdateUser, useUsers } from '../hooks';
import { AdminNav } from './AdminNav';
import { TemporaryPassword } from './TemporaryPassword';
import { UserRow } from './UserRow';

export function UserManagement() {
  const { user: currentUser } = useAuth();
  const navigate = useNavigate();

  const { data: users = [], isLoading, error } = useUsers();
  const deleteUserMutation = useDeleteUser();
  const updateUserMutation = useUpdateUser();
  const resetPasswordMutation = useResetUserPassword();
  const [issuedPassword, setIssuedPassword] = useState<ResetUserPasswordResult | null>(null);

  const handleResetPassword = async (userId: string) => {
    if (!confirm('Reset this password? They will be signed out and need the new one to sign in.')) {
      return;
    }
    try {
      setIssuedPassword(await resetPasswordMutation.mutateAsync(userId));
    } catch (err) {
      console.error(err instanceof Error ? err.message : 'Failed to reset password');
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm('Are you sure you want to delete this user?')) return;

    try {
      await deleteUserMutation.mutateAsync(userId);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete user';
      console.error(errorMessage);
    }
  };

  const handleToggleUserStatus = async (userId: string, isActive: boolean) => {
    try {
      await updateUserMutation.mutateAsync({
        userId,
        userData: { isActive } as any, // Type assertion due to mismatch between UpdateUserRequest and Partial<User>
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update user';
      console.error(errorMessage);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-10 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => navigate({ to: '/' })}
              className="px-3 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium focus-ring inline-flex items-center gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Dashboard
            </button>
            <AdminNav />
          </div>
          <button
            type="button"
            onClick={() => navigate({ to: '/admin/create-temporary-user' })}
            className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-md text-sm font-medium focus-ring inline-flex items-center gap-2"
          >
            <ShieldCheck className="h-4 w-4" />
            Create User
          </button>
        </div>
        <h1 className="text-3xl font-bold text-foreground">User Management</h1>

        {(error ||
          deleteUserMutation.error ||
          updateUserMutation.error ||
          resetPasswordMutation.error) && (
          <div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded mb-4">
            {error?.message ||
              deleteUserMutation.error?.message ||
              updateUserMutation.error?.message ||
              resetPasswordMutation.error?.message}
          </div>
        )}

        {issuedPassword && (
          <TemporaryPassword
            username={issuedPassword.username}
            email={issuedPassword.email}
            password={issuedPassword.tempPassword}
            onDismiss={() => setIssuedPassword(null)}
          />
        )}

        <div className="bg-card shadow overflow-x-auto sm:rounded-md">
          {isLoading ? (
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
                  <UserRow
                    key={user.id}
                    user={user}
                    currentUser={currentUser}
                    onDelete={handleDeleteUser}
                    onToggleStatus={handleToggleUserStatus}
                    onResetPassword={handleResetPassword}
                    resetPending={resetPasswordMutation.isPending}
                    deleteUserMutation={deleteUserMutation}
                    updateUserMutation={updateUserMutation}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
