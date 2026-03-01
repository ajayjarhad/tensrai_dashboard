import { Gamepad2, LocateFixed, Pause, Play, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface MissionActionsProps {
  isOpen: boolean;
  showMissionControls?: boolean;
  isMissionPaused?: boolean;
  isMissionActive?: boolean;
  disableMissionControls?: boolean;
  disableManualControl?: boolean;
  disabledReason?: string | undefined;
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
  disableMissionControls = false,
  disableManualControl = false,
  disabledReason,
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
              disabled={!active || disableMissionControls}
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
              disabled={!active || disableMissionControls}
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
          disabled={disableManualControl}
        >
          <Gamepad2 className="h-4 w-4" />
          Manual Control
        </Button>
        <Button type="button" variant="secondary" className="flex-1" onClick={() => onSetPose?.()}>
          <LocateFixed className="h-4 w-4" />
          Set Pose
        </Button>
      </div>
      {disabledReason && (disableMissionControls || disableManualControl) && (
        <div className="text-xs text-muted-foreground">{disabledReason}</div>
      )}
    </div>
  );
}
