import { Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { MissionWithContext } from '../../types';
import {
  type MissionDockProps,
  matchesFocus,
  missionElapsedLabel,
  type OngoingMissionView,
  statusClass,
} from './missionDockModel';

type OngoingTabProps = Pick<
  MissionDockProps,
  | 'robots'
  | 'missions'
  | 'ongoingMissions'
  | 'focusedMission'
  | 'selectedRobotId'
  | 'onFocusMission'
  | 'onClearFocus'
> & { clockNowMs: number };

function FocusedMissionSteps({
  mission,
  currentWaypoint,
  onClearFocus,
}: {
  mission: MissionWithContext;
  currentWaypoint: number;
  onClearFocus: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">{mission.name}</div>
        <Button type="button" size="sm" variant="outline" onClick={onClearFocus}>
          Clear Focus
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {mission.steps.map((step, idx) => {
          const label =
            mission.locationTags.find(tag => String(tag.id) === String(step))?.name ?? String(step);
          const stepNum = idx + 1;
          const isDone = currentWaypoint > 0 && stepNum < currentWaypoint;
          const isCurrent = currentWaypoint > 0 && stepNum === currentWaypoint;
          return (
            <span
              key={`${mission.id}-${step}-${idx}`}
              className={cn(
                'px-2 py-1 rounded-full text-xs border',
                isDone && 'bg-status-active/15 text-status-active border-status-active/40',
                isCurrent && 'bg-blue-500/15 text-blue-700 border-blue-500/40',
                !isDone && !isCurrent && 'bg-background text-muted-foreground border-border'
              )}
            >
              {isDone ? '✓ ' : isCurrent ? '▶ ' : '○ '}
              {label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function OngoingMissionCard({
  mission,
  isFocused,
  pinned,
  clockNowMs,
  onFocus,
}: {
  mission: OngoingMissionView;
  isFocused: boolean;
  pinned: boolean;
  clockNowMs: number;
  onFocus: () => void;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border p-3 space-y-2',
        isFocused ? 'border-status-active/50 bg-status-active/5' : 'border-border bg-muted/20'
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">{mission.missionName}</div>
          <div className="text-xs text-muted-foreground truncate">
            {mission.robotName}
            {pinned ? ' • selected robot' : ''}
            {mission.mapName ? ` • ${mission.mapName}` : ''}
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant={isFocused ? 'default' : 'outline'}
          onClick={onFocus}
        >
          <Target className="h-3.5 w-3.5 mr-1" />
          Focus
        </Button>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className={cn('px-2 py-0.5 rounded-full', statusClass(mission.status))}>
          {mission.status.toUpperCase()}
        </span>
        <span className="text-muted-foreground">
          {mission.waypointIndex ?? 0}/{mission.totalWaypoints ?? 0}
        </span>
        <span className="text-muted-foreground">{missionElapsedLabel(mission, clockNowMs)}</span>
      </div>
    </div>
  );
}

export function OngoingTab({
  robots,
  missions,
  ongoingMissions,
  focusedMission,
  selectedRobotId,
  clockNowMs,
  onFocusMission,
  onClearFocus,
}: OngoingTabProps) {
  const focusedMissionMeta =
    focusedMission !== null
      ? (missions.find(
          mission =>
            mission.id === focusedMission.missionId &&
            (!mission.mapId ||
              mission.mapId === robots.find(r => r.id === focusedMission.robotId)?.mapId)
        ) ?? missions.find(mission => mission.id === focusedMission.missionId))
      : null;
  const focusedProgress = ongoingMissions.find(
    mission =>
      mission.robotId === focusedMission?.robotId && mission.missionId === focusedMission?.missionId
  );

  return (
    <div className="p-3 space-y-3">
      {focusedMissionMeta && (
        <FocusedMissionSteps
          mission={focusedMissionMeta}
          currentWaypoint={focusedProgress?.waypointIndex ?? 0}
          onClearFocus={onClearFocus}
        />
      )}

      {ongoingMissions.length === 0 && (
        <div className="text-sm text-muted-foreground">No ongoing missions.</div>
      )}

      {ongoingMissions.map(mission => (
        <OngoingMissionCard
          key={`${mission.robotId}:${mission.missionId ?? 'unknown'}`}
          mission={mission}
          isFocused={focusedMission !== null && matchesFocus(mission, focusedMission)}
          pinned={selectedRobotId === mission.robotId}
          clockNowMs={clockNowMs}
          onFocus={() => onFocusMission(mission.robotId, mission.missionId)}
        />
      ))}
    </div>
  );
}
