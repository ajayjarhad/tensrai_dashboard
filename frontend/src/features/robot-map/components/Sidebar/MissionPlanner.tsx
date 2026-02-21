import { ArrowRight, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Robot } from '@/types/robot';
import type { MissionWithContext } from '../MissionDialog';

interface MissionPlannerProps {
  missions: MissionWithContext[];
  selectedRobot?: Robot | null;
  pendingMission?: MissionWithContext | null;
  onRequestStart: (mission: MissionWithContext) => void;
  onConfirmStart: () => void;
  onCancelStart: () => void;
}

const getMissionSteps = (
  mission: MissionWithContext
): { steps: string[]; locationMap: Map<string, string> } => {
  const stepsArray = Array.isArray(mission.steps) ? mission.steps : [];
  const locationMap = new Map(
    (mission.locationTags ?? []).map(tag => [String(tag.id), tag.name] as const)
  );
  return { steps: stepsArray, locationMap };
};

export function MissionPlanner({
  missions,
  selectedRobot,
  pendingMission,
  onRequestStart,
  onConfirmStart,
  onCancelStart,
}: MissionPlannerProps) {
  const missionList = missions ?? [];

  if (pendingMission) {
    const { steps, locationMap } = getMissionSteps(pendingMission);

    return (
      <div className="space-y-3 rounded-lg border border-border/60 bg-muted/40 p-3">
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Confirm Mission Start
          </div>
          <div className="text-sm font-semibold text-foreground">{pendingMission.name}</div>
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" />
            {pendingMission.mapName}
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">Tasks</div>
          <div className="flex flex-wrap items-center gap-2">
            {steps.length === 0 && <span className="text-xs text-muted-foreground">No steps</span>}
            {steps.map((step, idx) => {
              const label = locationMap.get(step) || step;
              return (
                <div
                  className="flex items-center gap-1.5"
                  key={`${pendingMission.id}-confirm-step-${step}-${idx}`}
                >
                  <span className="px-2 py-0.5 rounded-full bg-background text-xs text-foreground border border-border">
                    {label}
                  </span>
                  {idx < steps.length - 1 && (
                    <ArrowRight className="h-3 w-3 text-muted-foreground/70" />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex gap-2">
          <Button type="button" variant="default" className="flex-1" onClick={onConfirmStart}>
            Confirm Start
          </Button>
          <Button type="button" variant="outline" className="flex-1" onClick={onCancelStart}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  const missionsByMap = missionList.reduce<
    Array<{ mapId: string; mapName: string; missions: MissionWithContext[] }>
  >((acc, mission) => {
    const existing = acc.find(entry => entry.mapId === mission.mapId);
    if (existing) {
      existing.missions.push(mission);
    } else {
      acc.push({ mapId: mission.mapId, mapName: mission.mapName, missions: [mission] });
    }
    return acc;
  }, []);

  return (
    <div className="space-y-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">Missions</div>

      {missionList.length === 0 && (
        <div className="text-xs text-muted-foreground">No missions available.</div>
      )}

      {missionsByMap.map(group => (
        <div key={group.mapId} className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {group.mapName}
          </div>
          {group.missions.map(mission => {
            const { steps, locationMap } = getMissionSteps(mission);
            const canStart = Boolean(selectedRobot);

            return (
              <div
                key={mission.id}
                className="border border-border rounded-lg p-3 space-y-3 bg-muted/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-sm font-semibold text-foreground">{mission.name}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5" />
                      {mission.mapName}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="default"
                    disabled={!canStart}
                    className={cn(
                      canStart
                        ? '!bg-status-primary !text-foreground hover:!bg-status-primary/90 !border-status-active/50'
                        : '!bg-muted !text-muted-foreground !border-border'
                    )}
                    onClick={() => canStart && onRequestStart(mission)}
                  >
                    {canStart ? 'Show Up' : 'Select robot'}
                  </Button>
                </div>

                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">Tasks</div>
                  <div className="flex flex-wrap items-center gap-2">
                    {steps.length === 0 && (
                      <span className="text-xs text-muted-foreground">No steps</span>
                    )}
                    {steps.map((step, idx) => {
                      const label = locationMap.get(step) || step;
                      return (
                        <div
                          className="flex items-center gap-1.5"
                          key={`${mission.id}-step-${step}-${idx}`}
                        >
                          <span className="px-2 py-0.5 rounded-full bg-background text-xs text-foreground border border-border">
                            {label}
                          </span>
                          {idx < steps.length - 1 && (
                            <ArrowRight className="h-3 w-3 text-muted-foreground/70" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
