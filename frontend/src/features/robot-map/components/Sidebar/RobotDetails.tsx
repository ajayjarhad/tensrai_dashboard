import { Battery, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Robot } from '@/types/robot';

interface RobotDetailsProps {
  robot: Robot;
  mapName?: string;
}

const statusBadgeClass = (robot: Robot) => {
  if (robot.runtimeMode === 'teleop') return 'bg-amber-500/20 text-amber-600';
  if (robot.runtimeMode === 'autonomous') return 'bg-status-active/15 text-status-active';

  const value = String(robot.status ?? 'UNKNOWN').toUpperCase();
  if (value.includes('EMERGENCY')) return 'bg-status-error/15 text-status-error';
  if (value === 'MISSION') return 'bg-status-active/15 text-status-active';
  if (value === 'TELEOP') return 'bg-amber-500/20 text-amber-600';
  if (value === 'CHARGING' || value === 'DOCKING') return 'bg-sky-500/20 text-sky-600';
  return 'bg-status-offline/20 text-status-offline';
};

export function RobotDetails({ robot, mapName }: RobotDetailsProps) {
  const badgeLabel = robot.runtimeMode ? robot.runtimeMode.toUpperCase() : robot.status;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-2xl font-bold text-foreground">{robot.name}</h3>
        <div className="flex items-center mt-2 space-x-2">
          <span
            className={cn('px-2 py-1 text-xs font-medium rounded-full', statusBadgeClass(robot))}
          >
            {badgeLabel}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="p-3 bg-muted rounded-lg">
          <div className="flex items-center text-muted-foreground mb-1">
            <Battery className="w-4 h-4 mr-2" />
            <span className="text-xs font-medium">Battery</span>
          </div>
          <span className="text-lg font-semibold">
            {robot.battery !== undefined ? `${Math.round(robot.battery)}%` : '--'}
          </span>
          {robot.runtimeChargingStatus && (
            <div className="text-xs text-muted-foreground mt-1">{robot.runtimeChargingStatus}</div>
          )}
        </div>

        <div className="p-3 bg-muted rounded-lg">
          <div className="flex items-center text-muted-foreground mb-1">
            <MapPin className="w-4 h-4 mr-2" />
            <span className="text-xs font-medium">Map</span>
          </div>
          <span className="text-lg font-semibold uppercase">{mapName || robot.mapId || '--'}</span>
        </div>
      </div>
    </div>
  );
}
