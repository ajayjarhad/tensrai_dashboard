import type { UseMutationResult } from '@tanstack/react-query';
import { ROLE, type User } from '@tensrai/shared';
import { KeyRound, Trash2 } from 'lucide-react';

interface UserRowProps {
  user: User;
  currentUser: User | null;
  onDelete: (userId: string) => void;
  onToggleStatus: (userId: string, isActive: boolean) => void;
  onResetPassword: (userId: string) => void;
  resetPending: boolean;
  deleteUserMutation: UseMutationResult<void, Error, string>;
  updateUserMutation: UseMutationResult<
    void,
    Error,
    { userId: string; userData: { isActive: boolean } }
  >;
}

// Your own account shows its status without the switch: turning it off would lock you out.
function StatusCell({
  isActive,
  canToggle,
  pending,
  onToggle,
}: {
  isActive: boolean;
  canToggle: boolean;
  pending: boolean;
  onToggle: () => void;
}) {
  const status = isActive ? 'Active' : 'Inactive';
  if (!canToggle) {
    return (
      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full text-foreground">
        {status}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={pending}
      className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full cursor-pointer focus-ring ${
        isActive
          ? 'bg-card text-foreground hover:bg-accent'
          : 'bg-muted text-muted-foreground hover:bg-accent'
      } ${pending ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      {pending ? 'Updating...' : status}
    </button>
  );
}

export function UserRow({
  user,
  currentUser,
  onDelete,
  onToggleStatus,
  onResetPassword,
  resetPending,
  deleteUserMutation,
  updateUserMutation,
}: UserRowProps) {
  const canManage = user.role !== ROLE.STAFF || currentUser?.role === ROLE.STAFF;
  const isYou = user.id === currentUser?.id;

  return (
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
        <StatusCell
          isActive={user.isActive}
          canToggle={canManage && !isYou}
          pending={updateUserMutation.isPending}
          onToggle={() => onToggleStatus(user.id, !user.isActive)}
        />
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
        {new Date(user.createdAt).toLocaleDateString()}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-3">
        {canManage && (
          <button
            type="button"
            onClick={() => onResetPassword(user.id)}
            disabled={resetPending}
            className={`text-primary hover:text-primary/80 focus-ring inline-flex items-center gap-1 ${
              resetPending ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            <KeyRound className="h-4 w-4" />
            Reset password
          </button>
        )}
        {canManage && !isYou && (
          <button
            type="button"
            onClick={() => onDelete(user.id)}
            disabled={deleteUserMutation.isPending}
            className={`text-destructive hover:text-destructive/80 focus-ring inline-flex items-center gap-1 ${
              deleteUserMutation.isPending ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            <Trash2 className="h-4 w-4" />
            {deleteUserMutation.isPending ? 'Deleting...' : 'Delete'}
          </button>
        )}
      </td>
    </tr>
  );
}
