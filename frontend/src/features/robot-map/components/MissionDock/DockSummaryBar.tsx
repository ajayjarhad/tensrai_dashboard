import { ChevronDown, ChevronUp, Pause, Play, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isRobotEmergencyActive } from '@/lib/robotStatus';
import { cn } from '@/lib/utils';
import {
  type MissionDockProps,
  matchesFocus,
  missionElapsedLabel,
  type OngoingMissionView,
  statusClass,
} from './missionDockModel';

type MissionControlProps = Pick<
  MissionDockProps,
  'onPauseMission' | 'onResumeMission' | 'onCancelMission'
>;

type DockSummaryBarProps = MissionControlProps &
  Pick<MissionDockProps, 'robots' | 'ongoingMissions' | 'focusedMission'> & {
    clockNowMs: number;
    expanded: boolean;
    onToggleExpanded: () => void;
  };

function SummaryLine({ mission, clockNowMs }: { mission: OngoingMissionView; clockNowMs: number }) {
  return (
    <div className="flex items-center gap-2 overflow-hidden">
      <span className="font-semibold truncate pointer-events-auto">{mission.missionName}</span>
      <span
        className={cn(
          'px-2 py-0.5 rounded-full text-xs pointer-events-auto',
          statusClass(mission.status)
        )}
      >
        {mission.status.toUpperCase()}
      </span>
      <span className="text-muted-foreground truncate pointer-events-auto">
        {mission.robotName}
      </span>
      <span className="text-muted-foreground pointer-events-auto">
        {mission.waypointIndex ?? 0}/{mission.totalWaypoints ?? 0}
      </span>
      <span className="text-muted-foreground pointer-events-auto">
        {missionElapsedLabel(mission, clockNowMs)}
      </span>
    </div>
  );
}

function SummaryControls({
  mission,
  disabled,
  onPauseMission,
  onResumeMission,
  onCancelMission,
}: MissionControlProps & { mission: OngoingMissionView; disabled: boolean }) {
  return (
    <div className="relative z-10 flex items-center gap-1 pointer-events-none">
      {mission.status === 'paused' ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 pointer-events-auto"
          onClick={() => onResumeMission(mission.robotId, mission.missionId)}
          disabled={disabled}
        >
          <Play className="h-3.5 w-3.5 mr-1" />
          Resume
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 pointer-events-auto"
          onClick={() => onPauseMission(mission.robotId, mission.missionId)}
          disabled={disabled}
        >
          <Pause className="h-3.5 w-3.5 mr-1" />
          Pause
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        variant="destructive"
        className="h-8 pointer-events-auto"
        onClick={() => onCancelMission(mission.robotId, mission.missionId)}
        disabled={disabled}
      >
        <XCircle className="h-3.5 w-3.5 mr-1" />
        Cancel
      </Button>
    </div>
  );
}

export function DockSummaryBar({
  robots,
  ongoingMissions,
  focusedMission,
  clockNowMs,
  expanded,
  onToggleExpanded,
  onPauseMission,
  onResumeMission,
  onCancelMission,
}: DockSummaryBarProps) {
  const summaryMission =
    (focusedMission && ongoingMissions.find(mission => matchesFocus(mission, focusedMission))) ??
    ongoingMissions[0];
  const summaryRobot = robots.find(robot => robot.id === summaryMission?.robotId);

  return (
    <div
      className={cn(
        'relative flex items-center gap-3 px-3 py-2 border-b border-border/60',
        !expanded && 'cursor-pointer'
      )}
    >
      {!expanded && (
        <button
          type="button"
          aria-label="Expand mission dock"
          className="absolute inset-0 z-0"
          onClick={onToggleExpanded}
        />
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onToggleExpanded}
        className="relative z-20 h-8 px-2 pointer-events-auto"
      >
        {expanded ? (
          <>
            <ChevronDown className="h-4 w-4 mr-1.5" />
            Collapse
          </>
        ) : (
          <>
            <ChevronUp className="h-4 w-4 mr-1.5" />
            Expand
          </>
        )}
      </Button>

      <div className="relative z-10 flex-1 min-w-0 text-sm pointer-events-none">
        {summaryMission ? (
          <SummaryLine mission={summaryMission} clockNowMs={clockNowMs} />
        ) : (
          <span className="text-muted-foreground pointer-events-auto">No ongoing missions</span>
        )}
      </div>

      {summaryMission && (
        <SummaryControls
          mission={summaryMission}
          disabled={summaryRobot ? isRobotEmergencyActive(summaryRobot) : false}
          onPauseMission={onPauseMission}
          onResumeMission={onResumeMission}
          onCancelMission={onCancelMission}
        />
      )}
    </div>
  );
}
