import { Link } from '@tanstack/react-router';
import { PERMISSIONS, type Permission } from '@tensrai/shared';
import { Menu } from 'lucide-react';
import { useRef } from 'react';
import { useDetailsDismiss } from '@/hooks/useDetailsDismiss';
import { useAuth } from '@/stores/auth';

// The same permissions as the route guards, so a link can never lead to the unauthorized page.
const LINKS = [
  { to: '/', label: 'Dashboard', permission: PERMISSIONS.DASHBOARD_VIEW },
  { to: '/maps', label: 'Maps', permission: PERMISSIONS.MAPS_VIEW },
  { to: '/admin/robots', label: 'Robots', permission: PERMISSIONS.USER_MANAGEMENT },
  { to: '/admin/users', label: 'Users', permission: PERMISSIONS.USER_MANAGEMENT },
  { to: '/staff', label: 'Organizations', permission: PERMISSIONS.STAFF_CONSOLE },
] as const;

export const appLinks = (hasPermission: (permission: Permission) => boolean) =>
  LINKS.filter(link => hasPermission(link.permission));

// Text tabs from 1024px; the current page is the darker one with a bar on the header's edge.
export function AppNavTabs() {
  const { hasPermission } = useAuth();

  return (
    <nav aria-label="Main" className="hidden min-w-0 items-stretch gap-1 lg:flex">
      {appLinks(hasPermission).map(({ to, label }) => (
        <Link
          key={to}
          to={to}
          activeOptions={{ exact: to === '/' }}
          className="relative inline-flex flex-shrink-0 items-center px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-ring-strong data-[status=active]:text-foreground data-[status=active]:after:absolute data-[status=active]:after:inset-x-3 data-[status=active]:after:-bottom-px data-[status=active]:after:h-0.5 data-[status=active]:after:rounded-full data-[status=active]:after:bg-foreground"
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

// Below 1024px the tabs fold into a native disclosure, so the menu needs no dropdown library.
export function AppNavMenu() {
  const { hasPermission } = useAuth();
  const ref = useRef<HTMLDetailsElement>(null);
  useDetailsDismiss(ref);

  return (
    <details ref={ref} className="relative self-center lg:hidden">
      <summary
        aria-label="Menu"
        className="grid h-10 w-10 cursor-pointer list-none place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-ring-strong [&::-webkit-details-marker]:hidden"
      >
        <Menu className="h-5 w-5" aria-hidden />
      </summary>
      <nav
        aria-label="Main"
        className="absolute left-0 top-[calc(100%+8px)] z-50 grid min-w-[232px] gap-0.5 rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-md"
      >
        {appLinks(hasPermission).map(({ to, label }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: to === '/' }}
            className="rounded-md px-2.5 py-2 text-sm hover:bg-muted focus-ring-strong data-[status=active]:bg-muted data-[status=active]:font-semibold"
          >
            {label}
          </Link>
        ))}
      </nav>
    </details>
  );
}
