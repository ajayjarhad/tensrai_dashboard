import { AlertTriangle } from 'lucide-react';
import { EmergencyStopGuard } from '@/components/guards/PermissionGuard';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/utils';

export interface FleetEmergencyControlsProps {
  pendingDesiredStatus?: boolean | null;
  canSendEmergency?: boolean;
  canReleaseSoftware?: boolean;
  onEmergencyAll?: () => void;
  onReleaseSoftware?: () => void;
}

// The fleet stop on every signed-in page: a red button in a yellow housing (ISO 13850), always last
// in the header.
export function FleetEmergencyControls({
  pendingDesiredStatus = null,
  canSendEmergency = false,
  canReleaseSoftware = false,
  onEmergencyAll,
  onReleaseSoftware,
}: FleetEmergencyControlsProps) {
  // Only a stop already on its way holds this back: a release waiting on a slow robot's ack must
  // not delay a stop.
  const stopDisabled = !canSendEmergency || pendingDesiredStatus === true;

  return (
    <EmergencyStopGuard>
      {/* Release sits on the inside so the stop doesn't move when it appears. */}
      <div className="flex flex-shrink-0 items-center gap-2 sm:gap-3">
        {canReleaseSoftware && (
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={onReleaseSoftware}
            disabled={pendingDesiredStatus !== null}
            className="h-11 px-3 font-bold tracking-wide safety-critical sm:px-5"
          >
            Release
          </Button>
        )}
        {/* The whole housing dims when disabled, so the red never turns orange over the yellow. */}
        <span
          className={cn(
            'flex rounded-[10px] bg-safety-housing p-[3px]',
            stopDisabled && 'opacity-50'
          )}
        >
          <Button
            type="button"
            variant="destructive"
            onClick={onEmergencyAll}
            disabled={stopDisabled}
            className="h-[38px] rounded-[7px] bg-estop-fill px-3.5 font-bold tracking-wide hover:bg-estop-fill hover:brightness-95 disabled:opacity-100 safety-critical [&_svg]:size-[18px]"
          >
            <AlertTriangle aria-hidden />
            Emergency stop
          </Button>
        </span>
      </div>
    </EmergencyStopGuard>
  );
}
