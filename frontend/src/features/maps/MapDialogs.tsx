import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useMapSync } from '@/features/admin/hooks/useMapSync';
import { evictFromCache } from '@/lib/map/loadMapAssets';
import type { Robot } from '@/types/robot';
import { errorMessageOf, type MapSummary, mapsApi } from './api';
import { useRefreshMaps } from './queries';

const closeOn = (onClose: () => void) => (open: boolean) => {
  if (!open) onClose();
};

export function RenameMapDialog({ map, onClose }: { map: MapSummary; onClose: () => void }) {
  const [name, setName] = useState(map.name);
  const [busy, setBusy] = useState(false);
  const refreshMaps = useRefreshMaps();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await mapsApi.update(map.id, { name: name.trim() });
      await refreshMaps();
      onClose();
    } catch (error) {
      toast.error(errorMessageOf(error, "Couldn't rename the map."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={closeOn(onClose)}>
      <DialogContent className="max-w-[440px]">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Rename map</DialogTitle>
            <DialogDescription>
              Robots keep the map under its file name, {map.filename}.
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label="Name"
            value={name}
            maxLength={100}
            required
            autoFocus
            onChange={event => setName(event.target.value)}
            className="border-input-strong"
          />
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim() || name.trim() === map.name}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const PHASE_TEXT: Record<string, string> = {
  connecting: 'Connecting…',
  manifest: 'Comparing maps…',
  receiving: 'Receiving…',
  processing: 'Saving…',
};

export function ImportFromRobotDialog({
  robots,
  onClose,
}: {
  robots: Robot[];
  onClose: () => void;
}) {
  const reachable = robots.filter(robot => robot.ipAddress && robot.mappingBridgePort);
  const [robotId, setRobotId] = useState(reachable[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const { statusByRobotId, runMapSync } = useMapSync();
  const refreshMaps = useRefreshMaps();
  const robot = reachable.find(candidate => candidate.id === robotId);
  const phase = statusByRobotId[robotId]?.phase;

  const run = async () => {
    if (!robot) return;
    setBusy(true);
    try {
      const status = await runMapSync(robot.id);
      for (const map of robot.maps ?? []) evictFromCache(map.id);
      if (status?.mapId) evictFromCache(status.mapId);
      await refreshMaps();
      toast.success(`Imported maps from ${robot.name}`);
      onClose();
    } catch (error) {
      toast.error(errorMessageOf(error, 'The import failed.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={closeOn(onClose)}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Import from robot</DialogTitle>
          <DialogDescription>
            Bring in the maps a robot made itself, with its location tags and missions. Maps you
            edited here are kept; a robot that changed one too shows a conflict to resolve.
          </DialogDescription>
        </DialogHeader>
        {reachable.length === 0 ? (
          <p className="text-sm text-muted-foreground">No robot has a mapping bridge set up.</p>
        ) : (
          <select
            aria-label="Robot"
            value={robotId}
            disabled={busy}
            onChange={event => setRobotId(event.target.value)}
            className="h-10 rounded-md border border-input-strong bg-background px-3 text-sm focus-ring-strong"
          >
            {reachable.map(candidate => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        )}
        <DialogFooter className="items-center gap-2">
          {busy && phase && (
            <output className="mr-auto text-sm text-muted-foreground">
              {PHASE_TEXT[phase] ?? 'Importing…'}
            </output>
          )}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={run} disabled={busy || !robot}>
            {busy ? 'Importing…' : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
