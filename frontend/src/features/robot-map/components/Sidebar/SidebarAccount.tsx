import { LogOut } from 'lucide-react';
import { AdminNav } from '@/features/admin/components/AdminNav';
import { useAuth } from '@/stores/auth';

export function SidebarAccount({ isOpen }: { isOpen: boolean }) {
  const { user, logout } = useAuth();

  const avatar = (
    <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center text-foreground/80 text-sm font-semibold">
      {user?.displayName?.slice(0, 1)?.toUpperCase() || 'U'}
    </div>
  );
  const logOutButton = (
    <button
      type="button"
      onClick={logout}
      className="p-2 rounded-md hover:bg-muted transition-colors"
      title="Log out"
      aria-label="Log out"
    >
      <LogOut className="h-4 w-4" />
    </button>
  );

  return (
    <div className="p-4 border-border bg-card space-y-3">
      <div className="border-b border-border/60" />
      <AdminNav vertical iconsOnly={!isOpen} />

      {isOpen ? (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {avatar}
            <div>
              <div className="text-sm font-medium text-foreground">
                {user?.displayName || user?.username || 'User'}
              </div>
              <div className="text-xs text-muted-foreground">{user?.role || 'USER'}</div>
            </div>
          </div>
          {logOutButton}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          {avatar}
          {logOutButton}
        </div>
      )}
    </div>
  );
}
