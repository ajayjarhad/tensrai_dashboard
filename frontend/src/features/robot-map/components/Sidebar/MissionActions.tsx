import { Gamepad2, LocateFixed } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface MissionActionsProps {
  onManualControl?: (() => void) | undefined;
  onSetPose?: (() => void) | undefined;
}

export function MissionActions({ onManualControl, onSetPose }: MissionActionsProps) {
  return (
    <div className="pt-3 mt-auto border-t border-border/60 flex gap-2">
      <Button type="button" variant="secondary" className="flex-1" onClick={onManualControl}>
        <Gamepad2 className="h-4 w-4" />
        Manual Control
      </Button>
      <Button type="button" variant="secondary" className="flex-1" onClick={onSetPose}>
        <LocateFixed className="h-4 w-4" />
        Set Pose
      </Button>
    </div>
  );
}
