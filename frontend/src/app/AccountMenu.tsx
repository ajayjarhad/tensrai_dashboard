import { LogOut } from 'lucide-react';
import { useRef } from 'react';
import { useDetailsDismiss } from '@/hooks/useDetailsDismiss';
import { useAuth } from '@/stores/auth';

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

const roleLabel = (role: string | undefined) =>
  role ? role.charAt(0) + role.slice(1).toLowerCase() : 'User';

export function AccountMenu() {
  const { user, logout } = useAuth();
  const ref = useRef<HTMLDetailsElement>(null);
  useDetailsDismiss(ref);
  const name = user?.displayName || user?.username || 'User';

  return (
    <details ref={ref} className="relative">
      <summary
        aria-label={`Account: ${name}`}
        title={name}
        className="grid h-8 w-8 cursor-pointer list-none place-items-center rounded-full bg-muted text-xs font-semibold text-foreground focus-ring-strong [&::-webkit-details-marker]:hidden"
      >
        {initialsOf(name) || 'U'}
      </summary>
      <div className="absolute right-0 top-[calc(100%+8px)] z-50 grid min-w-[232px] gap-0.5 rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-md">
        <div className="px-2.5 py-2">
          <div className="text-sm font-semibold">{name}</div>
          <div className="text-xs text-muted-foreground">
            {[roleLabel(user?.role), user?.orgName].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div className="mx-1 my-0.5 h-px bg-border" />
        <button
          type="button"
          onClick={() => {
            void logout();
          }}
          className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted focus-ring-strong"
        >
          <LogOut className="h-4 w-4" aria-hidden />
          Sign out
        </button>
      </div>
    </details>
  );
}
