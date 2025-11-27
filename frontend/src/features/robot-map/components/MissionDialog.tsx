import type { ProcessedMapData } from '@tensrai/shared';
import { ArrowRight, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { Robot } from '@/types/robot';

export type MissionWithContext = {
  id: string;
  name: string;
  steps: string[];
  mapId: string;
  mapName: string;
  locationTags: NonNullable<ProcessedMapData['features']>['locationTags'];
  availableRobots: Robot[];
};

interface MissionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  missions: MissionWithContext[];
  onStartMission: (missionId: string) => void;
}

export function MissionDialog({
  open,
  onOpenChange,
  missions,
  onStartMission,
}: MissionDialogProps) {
  const missionList = missions ?? [];
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

  const mapCount = missionsByMap.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground">Select a mission</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Missions: {missionList.length} • Maps: {mapCount}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          {missionList.length === 0 && (
            <div className="text-sm text-muted-foreground">No missions available.</div>
          )}

          {missionsByMap.map(group => (
            <div key={group.mapId} className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.mapName}
              </div>
              {group.missions.map(mission => {
                const stepsArray = Array.isArray(mission.steps) ? mission.steps : [];
                const locationMap = new Map(
                  (mission.locationTags ?? []).map(tag => [tag.id, tag.name] as const)
                );
                const robotsOnMap = mission.availableRobots ?? [];
                const hasRobots = robotsOnMap.length > 0;

                return (
                  <div
                    key={mission.id}
                    className="border border-border rounded-lg p-4 space-y-4 bg-muted/40"
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
                        disabled={!hasRobots}
                        className={cn(
                          hasRobots
                            ? '!bg-status-primary !text-foreground hover:!bg-status-primary/90 !border-status-active/50'
                            : '!bg-muted !text-muted-foreground !border-border'
                        )}
                        onClick={() => hasRobots && onStartMission(mission.id)}
                      >
                        {hasRobots ? 'Start' : 'No robots'}
                      </Button>
                    </div>

                    <div className="space-y-1.5">
                      <div className="text-xs font-medium text-muted-foreground">Tasks</div>
                      <div className="flex flex-wrap items-center gap-2">
                        {stepsArray.length === 0 && (
                          <span className="text-xs text-muted-foreground">No steps</span>
                        )}
                        {stepsArray.map((step, idx) => {
                          const label = locationMap.get(step) || step;
                          return (
                            <div
                              className="flex items-center gap-1.5"
                              key={`${mission.id}-step-${step}-${idx}`}
                            >
                              <span className="px-2 py-0.5 rounded-full bg-background text-xs text-foreground border border-border">
                                {label}
                              </span>
                              {idx < stepsArray.length - 1 && (
                                <ArrowRight className="h-3 w-3 text-muted-foreground/70" />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="text-xs font-medium text-muted-foreground">Robots on map</div>
                      <div className="flex flex-wrap gap-1">
                        {hasRobots ? (
                          robotsOnMap.map(robot => {
                            const statusClass =
                              robot.status === 'MISSION'
                                ? 'bg-status-active'
                                : robot.status.includes('EMERGENCY')
                                  ? 'bg-status-error'
                                  : 'bg-muted-foreground';
                            return (
                              <span
                                key={robot.id}
                                className="inline-flex items-center gap-2 px-2 py-0.5 rounded-full bg-background text-xs border border-border"
                              >
                                <span className={cn('h-2 w-2 rounded-full', statusClass)} />
                                {robot.name}
                              </span>
                            );
                          })
                        ) : (
                          <span className="text-xs text-muted-foreground">None on this map</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
