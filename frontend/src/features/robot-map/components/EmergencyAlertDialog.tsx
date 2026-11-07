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

type EmergencyAlertDialogProps = {
  alert: EmergencyAlert | null;
  onAcknowledge: () => void;
};

export function EmergencyAlertDialog({ alert, onAcknowledge }: EmergencyAlertDialogProps) {
  return (
    <Dialog open={alert !== null}>
      <DialogContent
        className="bg-card border-safety-estop/30"
        onPointerDownOutside={event => event.preventDefault()}
        onEscapeKeyDown={event => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-safety-estop">Emergency Active</DialogTitle>
          <DialogDescription className="text-foreground/80">
            {alert
              ? `${alert.kind === 'hardware' ? 'Hardware' : 'Software'} emergency set on ${alert.robotName}.`
              : ''}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="destructive" onClick={onAcknowledge}>
            Acknowledge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
