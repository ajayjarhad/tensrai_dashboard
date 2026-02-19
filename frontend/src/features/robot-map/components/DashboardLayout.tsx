import type { ReactNode } from 'react';
import { EmergencyHeader } from '../../emergency-stop/emergency-header';

interface DashboardLayoutProps {
  sidebar: ReactNode;
  map: ReactNode;
  teleopPanel?: ReactNode;
  missionDock?: ReactNode;
}

export function DashboardLayout({ sidebar, map, teleopPanel, missionDock }: DashboardLayoutProps) {
  return (
    <div className="flex flex-col h-screen w-full overflow-hidden bg-background relative">
      <EmergencyHeader className="flex-shrink-0 z-20 relative" />
      <div className="flex flex-1 overflow-hidden relative w-full">
        <div className="flex-1 relative min-w-0">
          {map}
          {missionDock}
          {teleopPanel}
        </div>
        {sidebar}
      </div>
    </div>
  );
}
