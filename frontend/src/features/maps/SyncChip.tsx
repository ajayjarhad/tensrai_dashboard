import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MapRobot, MapRobotState } from './api';

// The robot's name, then one thing: a check when it has the latest version, otherwise progress or
// the next step. Never a state and an action together.
const TONE: Record<MapRobotState, string> = {
  synced: 'bg-status-online/[0.12] pr-[9px] text-status-online-ink',
  needs_sync: 'bg-status-warning/[0.12] text-status-warning-ink',
  syncing: 'bg-status-active/[0.12] pr-[9px] text-status-active-ink',
  failed: 'bg-status-error/[0.12] text-status-error-ink',
  conflict: 'border-status-warning text-status-warning-ink',
  unsupported: 'bg-status-offline/[0.12] pr-[9px] text-status-offline-ink',
};

const TITLE: Record<MapRobotState, string> = {
  synced: 'Up to date',
  needs_sync: 'Has an older version',
  syncing: 'Syncing',
  failed: 'The last sync failed',
  conflict: 'Changed on the robot too',
  unsupported: "This robot's software can't receive maps yet",
};

const ACTION: Partial<Record<MapRobotState, string>> = {
  needs_sync: 'Sync',
  failed: 'Retry',
  conflict: 'Resolve',
};

const PHASE: Record<NonNullable<MapRobot['phase']>, string> = {
  importing: 'Checking',
  sending: 'Sending',
  removing: 'Removing',
};

const STATE_TEXT: Partial<Record<MapRobotState, string>> = {
  needs_sync: 'Needs sync',
  failed: 'Failed',
  conflict: 'Conflict',
  unsupported: "Can't receive maps",
};

export function SyncChip({
  robot,
  onAction,
}: {
  robot: MapRobot;
  onAction?: ((robot: MapRobot) => void) | undefined;
}) {
  const action = onAction ? ACTION[robot.state] : undefined;
  return (
    <span
      title={robot.error ?? TITLE[robot.state]}
      className={cn(
        'inline-flex h-[26px] items-center gap-1.5 whitespace-nowrap rounded-full border border-transparent pl-2.5 pr-[3px] text-xs font-medium',
        TONE[robot.state],
        !action && 'pr-[9px]'
      )}
    >
      <span className="text-foreground">{robot.name}</span>
      {robot.state === 'synced' && <Check className="h-3 w-3" role="img" aria-label="up to date" />}
      {robot.state === 'syncing' && (
        <>
          <span
            aria-hidden
            className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
          <span className="tabular-nums">{PHASE[robot.phase ?? 'sending']}</span>
        </>
      )}
      {action ? (
        <button
          type="button"
          onClick={() => onAction?.(robot)}
          aria-label={`${action}: ${robot.name}`}
          className="inline-flex h-5 items-center rounded-full bg-card px-[9px] font-semibold shadow-[inset_0_0_0_1px_currentColor] hover:bg-muted focus-ring-strong"
        >
          {action}
        </button>
      ) : (
        STATE_TEXT[robot.state] && <span>{STATE_TEXT[robot.state]}</span>
      )}
    </span>
  );
}
