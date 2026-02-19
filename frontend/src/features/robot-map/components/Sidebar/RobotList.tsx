import { cn } from '@/lib/utils';
import type { Robot } from '@/types/robot';

interface RobotListProps {
  robots: Robot[];
  selectedRobotId: string | null;
  onSelectRobot: (robot: Robot | null) => void;
  isOpen: boolean;
}

const statusToneClass = (robot: Robot) => {
  if (robot.runtimeMode === 'teleop') return 'bg-amber-500';
  if (robot.runtimeMode === 'autonomous') return 'bg-status-active';

  const value = String(robot.status ?? 'UNKNOWN').toUpperCase();
  if (value.includes('EMERGENCY')) return 'bg-status-error';
  if (value === 'MISSION') return 'bg-status-active';
  if (value === 'TELEOP') return 'bg-amber-500';
  if (value === 'CHARGING' || value === 'DOCKING') return 'bg-sky-500';
  return 'bg-status-offline';
};

export function RobotList({ robots, selectedRobotId, onSelectRobot, isOpen }: RobotListProps) {
  if (!isOpen) {
    return (
      <div className="flex flex-col items-center py-4 space-y-4 w-16 mx-auto">
        {robots.map(robot => (
          <button
            type="button"
            key={robot.id}
            onClick={() => onSelectRobot(robot)}
            className={cn(
              'w-10 h-10 flex items-center justify-center rounded-full transition-colors relative',
              selectedRobotId === robot.id
                ? 'bg-primary/10 text-primary'
                : 'hover:bg-muted text-muted-foreground'
            )}
            title={robot.name}
          >
            <div
              className={cn(
                'absolute top-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white',
                statusToneClass(robot)
              )}
            />
            <span className="text-xs font-bold">{robot.name.substring(0, 2)}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="divide-y divide-border/60 min-w-[20rem]">
      {robots.map(robot => (
        <button
          key={robot.id}
          type="button"
          onClick={() => onSelectRobot(robot)}
          className={cn(
            'w-full text-left p-4 hover:bg-muted transition-colors focus:outline-none focus:bg-muted',
            selectedRobotId === robot.id && 'bg-primary/10 hover:bg-primary/10'
          )}
        >
          <div className="flex justify-between items-start mb-1">
            <span className="font-medium text-foreground">{robot.name}</span>
            <span className={cn('w-2 h-2 rounded-full mt-2', statusToneClass(robot))} />
          </div>
          <div className="flex justify-between items-center text-xs text-muted-foreground gap-2">
            <span className="truncate">
              {robot.runtimeMode ? robot.runtimeMode.toUpperCase() : robot.status}
            </span>
            <span>{robot.battery !== undefined ? `${Math.round(robot.battery)}%` : ''}</span>
          </div>
        </button>
      ))}
    </div>
  );
}
