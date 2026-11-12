import { CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDuration, type MissionLogView } from './missionDockModel';

const formatDateTime = (value?: number) => {
  if (!value) return '--';
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

export function LogsTab({ missionLogs }: { missionLogs: MissionLogView[] }) {
  return (
    <div className="p-3 space-y-2">
      {missionLogs.length === 0 && (
        <div className="text-sm text-muted-foreground">No completed/failed missions yet.</div>
      )}
      {missionLogs.map(log => (
        <div key={log.id} className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">{log.missionName}</div>
              <div className="text-xs text-muted-foreground">{log.robotName}</div>
            </div>
            <span
              className={cn(
                'px-2 py-0.5 rounded-full text-xs inline-flex items-center gap-1',
                log.result === 'completed'
                  ? 'bg-status-active/20 text-status-active'
                  : 'bg-status-error/20 text-status-error'
              )}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {log.result.toUpperCase()}
            </span>
          </div>
          <div className="text-xs text-muted-foreground grid grid-cols-1 md:grid-cols-2 gap-1">
            <div>Started: {formatDateTime(log.startedAt)}</div>
            <div>Ended: {formatDateTime(log.endedAt)}</div>
            <div>Duration: {formatDuration(log.durationMs)}</div>
            <div>
              Waypoints: {log.waypointIndex ?? 0}/{log.totalWaypoints ?? 0}
            </div>
          </div>
          {log.message && <div className="text-xs text-muted-foreground">{log.message}</div>}
        </div>
      ))}
    </div>
  );
}
