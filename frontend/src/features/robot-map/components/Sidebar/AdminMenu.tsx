import { useNavigate } from '@tanstack/react-router';
import { Cpu, LogOut, MoreVertical, Users } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/stores/auth';

interface AdminMenuProps {
  isOpen: boolean;
  onToggle: () => void;
}

export function AdminMenu({ isOpen, onToggle }: AdminMenuProps) {
  const navigate = useNavigate();
  const { user, isAdmin, logout } = useAuth();
  const isUserAdmin = typeof isAdmin === 'function' ? isAdmin() : Boolean(isAdmin);
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div className="p-4 border-border bg-card space-y-3">
      <div className="border-b border-border/60" />

      {isOpen ? (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center text-foreground/80 text-sm font-semibold">
              {user?.displayName?.slice(0, 1)?.toUpperCase() || 'U'}
            </div>
            <div>
              <div className="text-sm font-medium text-foreground">
                {user?.displayName || user?.username || 'User'}
              </div>
              <div className="text-xs text-muted-foreground">{user?.role || 'USER'}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isUserAdmin && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowMenu(prev => !prev)}
                  className="p-2 rounded-md hover:bg-muted transition-colors"
                  title="Admin settings"
                  aria-label="Admin settings"
                >
                  <MoreVertical className="h-4 w-4" />
                </button>
                {showMenu && (
                  <div className="absolute right-0 bottom-full mb-2 w-44 rounded-md bg-card border border-border shadow-lg z-20">
                    <button
                      type="button"
                      onClick={() => {
                        setShowMenu(false);
                        navigate({ to: '/admin/users' });
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors"
                    >
                      <Users className="h-4 w-4" />
                      Manage Users
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowMenu(false);
                        navigate({ to: '/admin/robots' });
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors"
                    >
                      <Cpu className="h-4 w-4" />
                      Manage Robots
                    </button>
                  </div>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={logout}
              className="p-2 rounded-md hover:bg-muted transition-colors"
              title="Log out"
              aria-label="Log out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center text-foreground/80 text-sm font-semibold">
            {user?.displayName?.slice(0, 1)?.toUpperCase() || 'U'}
          </div>
          <div className="flex flex-col items-center gap-2">
            {isUserAdmin && (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!isOpen) onToggle();
                    navigate({ to: '/admin/users' });
                  }}
                  className="p-2 rounded-md hover:bg-muted transition-colors"
                  title="Manage users"
                  aria-label="Manage users"
                >
                  <Users className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!isOpen) onToggle();
                    navigate({ to: '/admin/robots' });
                  }}
                  className="p-2 rounded-md hover:bg-muted transition-colors"
                  title="Manage robots"
                  aria-label="Manage robots"
                >
                  <Cpu className="h-4 w-4" />
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={logout}
              className="p-2 rounded-md hover:bg-muted transition-colors"
              title="Log out"
              aria-label="Log out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
