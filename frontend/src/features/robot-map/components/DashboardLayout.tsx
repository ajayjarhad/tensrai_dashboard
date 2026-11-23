import type { ReactNode } from 'react';

interface DashboardLayoutProps {
  sidebar: ReactNode;
  map: ReactNode;
  teleopPanel?: ReactNode;
  missionDock?: ReactNode;
}

export function DashboardLayout({ sidebar, map, teleopPanel, missionDock }: DashboardLayoutProps) {
  return (
    <div className="flex h-full w-full overflow-hidden bg-background relative">
      <div className="flex-1 relative min-w-0">
        {map}
        {missionDock}
        {teleopPanel}
      </div>
      {sidebar}
    </div>
  );
}
