import { Gamepad2, LocateFixed, Pause, Play, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface MissionActionsProps {
  isOpen: boolean;
  showMissionControls?: boolean;
  isMissionPaused?: boolean;
  isMissionActive?: boolean;
  onPause?: (() => void) | undefined;
  onResume?: (() => void) | undefined;
  onCancel?: (() => void) | undefined;
  onManualControl?: (() => void) | undefined;
  onSetPose?: (() => void) | undefined;
}

export function MissionActions({
  isOpen: _isOpen,
  showMissionControls = true,
  isMissionPaused,
  isMissionActive,
  onPause,
  onResume,
  onCancel,
  onManualControl,
  onSetPose,
}: MissionActionsProps) {
  const paused = Boolean(isMissionPaused);
  const active = Boolean(isMissionActive);

  const handlePauseResume = () => {
    if (paused) {
      onResume?.();
    } else {
      onPause?.();
    }
  };

  return (
    <div className="pt-3 mt-auto border-t border-border/60 space-y-3">
      {showMissionControls && (
        <>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={handlePauseResume}
              disabled={!active}
            >
              {paused ? (
                <>
                  <Play className="h-4 w-4" />
                  Resume
                </>
              ) : (
                <>
                  <Pause className="h-4 w-4" />
                  Pause
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="flex-1"
              onClick={() => onCancel?.()}
              disabled={!active}
            >
              <XCircle className="h-4 w-4" />
              Cancel
            </Button>
          </div>
          <div className="border-b border-border/60" />
        </>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          className="flex-1"
          onClick={() => onManualControl?.()}
        >
          <Gamepad2 className="h-4 w-4" />
          Manual Control
        </Button>
        <Button type="button" variant="secondary" className="flex-1" onClick={() => onSetPose?.()}>
          <LocateFixed className="h-4 w-4" />
          Set Pose
        </Button>
      </div>
    </div>
  );
}
