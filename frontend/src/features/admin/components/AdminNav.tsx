import { Link } from '@tanstack/react-router';
import { PERMISSIONS, type Permission } from '@tensrai/shared';
import { Building2, Cpu, Users } from 'lucide-react';
import { cn } from '@/lib/utils/utils';
import { useAuth } from '@/stores/auth';

// The same permissions as the route guards, so a link can never lead to the unauthorized page.
const LINKS = [
  { to: '/admin/users', label: 'Users', icon: Users, permission: PERMISSIONS.USER_MANAGEMENT },
  { to: '/admin/robots', label: 'Robots', icon: Cpu, permission: PERMISSIONS.USER_MANAGEMENT },
  { to: '/staff', label: 'Organizations', icon: Building2, permission: PERMISSIONS.STAFF_CONSOLE },
] as const;

export const adminLinks = (hasPermission: (permission: Permission) => boolean) =>
  LINKS.filter(link => hasPermission(link.permission));

interface AdminNavProps {
  vertical?: boolean;
  iconsOnly?: boolean;
}

export function AdminNav({ vertical = false, iconsOnly = false }: AdminNavProps) {
  const { hasPermission } = useAuth();
  const links = adminLinks(hasPermission);
  if (links.length === 0) return null;

  return (
    <nav
      aria-label="Administration"
      className={cn(
        'flex min-w-0 gap-1',
        vertical ? 'flex-col' : 'items-center overflow-x-auto',
        iconsOnly && 'items-center'
      )}
    >
      {links.map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          aria-label={label}
          title={label}
          className={cn(
            'inline-flex flex-shrink-0 items-center gap-2 py-2 rounded-md text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus-ring',
            iconsOnly ? 'px-2' : 'px-3'
          )}
          activeProps={{ className: 'bg-muted text-foreground' }}
        >
          <Icon className="h-4 w-4" />
          {!iconsOnly && <span>{label}</span>}
        </Link>
      ))}
    </nav>
  );
}
