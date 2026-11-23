import { Link } from '@tanstack/react-router';
import { AlertCircle } from 'lucide-react';
import { AppNavMenu, AppNavTabs } from '@/components/AppNav';
import {
  FleetEmergencyControls,
  type FleetEmergencyControlsProps,
} from '@/features/emergency-stop';
import { AccountMenu } from './AccountMenu';

interface AppHeaderProps {
  fleet: { online: string; stopped: string | null };
  controls: FleetEmergencyControlsProps;
}

// One quiet line on every signed-in page. Colour in it means something is wrong; only the E-stop
// housing is always coloured.
export function AppHeader({ fleet, controls }: AppHeaderProps) {
  return (
    <header className="flex h-16 flex-shrink-0 items-stretch gap-2 border-b border-border bg-card px-3 sm:gap-6 sm:pl-6 sm:pr-4">
      <AppNavMenu />
      <Link
        to="/"
        aria-label="Tensrai dashboard"
        className="flex flex-shrink-0 items-center gap-2.5 focus-ring-strong"
      >
        <img src="/assets/logo.png" alt="" className="h-7 w-7 object-contain" />
        <span className="hidden text-xl font-bold tracking-tight lg:inline">Tensrai</span>
      </Link>
      <AppNavTabs />
      <div className="ml-auto flex items-center gap-3 sm:gap-4">
        <output className="flex items-center gap-3 whitespace-nowrap text-[13px] text-muted-foreground">
          <span className="hidden lg:inline">{fleet.online}</span>
          {fleet.stopped && (
            <span className="hidden items-center gap-1.5 font-semibold text-status-error-ink sm:inline-flex">
              <AlertCircle className="h-4 w-4" aria-hidden />
              {fleet.stopped}
            </span>
          )}
        </output>
        <AccountMenu />
        <FleetEmergencyControls {...controls} />
      </div>
    </header>
  );
}
