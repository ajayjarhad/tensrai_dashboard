import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { EmergencyAlert } from '../types';
import { describeEmergencyAlerts } from '../utils/emergencyAlertText';

type EmergencyAlertDialogProps = {
  alerts: EmergencyAlert[];
  onAcknowledge: (ids: string[]) => void;
};

export function EmergencyAlertDialog({ alerts, onAcknowledge }: EmergencyAlertDialogProps) {
  return (
    <Dialog open={alerts.length > 0}>
      <DialogContent
        className="bg-card border-safety-estop/30"
        onPointerDownOutside={event => event.preventDefault()}
        onEscapeKeyDown={event => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-safety-estop">Emergency Active</DialogTitle>
          <DialogDescription className="text-foreground/80">
            {describeEmergencyAlerts(alerts)}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="destructive"
            onClick={() => onAcknowledge(alerts.map(alert => alert.id))}
          >
            Acknowledge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
