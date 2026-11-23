import { useQuery } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { useState } from 'react';
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
import { queryKeys } from '@/lib/query-keys';
import { cn } from '@/lib/utils';
import {
  type ConflictDetail,
  errorMessageOf,
  type MapRobot,
  type MapSummary,
  mapsApi,
} from './api';
import { compareCopies } from './conflict';
import { formatWhen } from './mapList';
import { useRefreshMaps } from './queries';

type Keep = 'dashboard' | 'robot';

const missionWord = (ids: string[]) =>
  ids.length === 1 ? `mission ${ids[0]} is` : `missions ${ids.join(' and ')} are`;

function Choice({
  value,
  keep,
  title,
  meta,
  lines,
  effect,
  onPick,
}: {
  value: Keep;
  keep: Keep;
  title: string;
  meta: string;
  lines: string[];
  effect: string;
  onPick: (value: Keep) => void;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer flex-col gap-2 rounded-lg p-3.5',
        keep === value
          ? 'border-2 border-ring-strong bg-primary/[0.08]'
          : 'border border-input-strong'
      )}
    >
      <span className="flex items-center gap-2">
        <input
          type="radio"
          name="keep"
          value={value}
          checked={keep === value}
          onChange={() => onPick(value)}
          className="accent-ring-strong"
        />
        <span className="font-semibold">{title}</span>
      </span>
      <span className="text-xs text-muted-foreground">{meta}</span>
      {lines.length > 0 && (
        <ul className="list-disc pl-[18px] text-sm leading-5">
          {lines.map(line => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <span className="text-xs text-status-warning-ink">{effect}</span>
    </label>
  );
}

const savedLine = (detail: ConflictDetail | undefined) =>
  detail?.ours.editedAt
    ? `Saved ${formatWhen(detail.ours.editedAt)}${detail.ours.editedBy ? ` by ${detail.ours.editedBy}` : ''}`
    : 'The dashboard copy';

const importedLine = (detail: ConflictDetail | undefined, robotName: string) =>
  detail?.robot.at
    ? `Imported from ${robotName} ${formatWhen(String(detail.robot.at)).replace(/^(Today|Yesterday)/, word => word.toLowerCase())}`
    : `${robotName}'s copy`;

const withUnchanged = (lines: string[] | undefined, unchanged: string | null) =>
  lines ? [...lines, ...(unchanged ? [unchanged] : [])] : [];

const sendOursEffect = (lost: string[]) =>
  lost.length
    ? `Replaces the robot's copy. Its ${missionWord(lost)} lost unless you add ${lost.length === 1 ? 'it' : 'them'} here first.`
    : "Replaces the robot's copy.";

export function ConflictDialog({
  map,
  robot,
  onClose,
}: {
  map: MapSummary;
  robot: MapRobot;
  onClose: () => void;
}) {
  const [keep, setKeep] = useState<Keep>('dashboard');
  const [busy, setBusy] = useState(false);
  const refreshMaps = useRefreshMaps();
  const { data: detail } = useQuery({
    queryKey: [...queryKeys.maps.detail(map.id), 'conflict', robot.robotId],
    queryFn: () => mapsApi.conflict(map.id, robot.robotId),
  });
  const changes = detail ? compareCopies(detail) : null;
  const lost = changes?.theirs.onlyMissions ?? [];

  const resolve = async () => {
    setBusy(true);
    try {
      await mapsApi.resolve(map.id, robot.robotId, keep);
      await refreshMaps();
      onClose();
    } catch (error) {
      toast.error(errorMessageOf(error, "Couldn't resolve the conflict."));
    } finally {
      setBusy(false);
    }
  };

  const unchanged = changes?.unchanged.length ? `Unchanged: ${changes.unchanged.join(', ')}` : null;

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-[660px]">
        <DialogHeader>
          <DialogTitle>
            {map.name} changed on {robot.name}
          </DialogTitle>
          <DialogDescription>
            The map was changed on the robot after its last sync, and you have saved edits it hasn't
            received. Choose which version {robot.name} keeps.
          </DialogDescription>
        </DialogHeader>
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="sr-only">Version to keep</legend>
          <Choice
            value="dashboard"
            keep={keep}
            title="Send ours"
            meta={savedLine(detail)}
            lines={withUnchanged(changes?.mine.lines, unchanged)}
            effect={sendOursEffect(lost)}
            onPick={setKeep}
          />
          <Choice
            value="robot"
            keep={keep}
            title="Take the robot's"
            meta={importedLine(detail, robot.name)}
            lines={withUnchanged(changes?.theirs.lines, unchanged)}
            effect={`Your saved edits to ${map.name} are replaced by the robot's version.`}
            onPick={setKeep}
          />
        </fieldset>
        <p className="grid grid-cols-[16px_1fr] gap-2.5 rounded-lg bg-muted p-3 text-sm">
          <Info className="mt-0.5 h-4 w-4" aria-hidden />
          Missions are still made on the robot. To keep both sets of changes, take the robot's
          version, then redo your edits here.
        </p>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Decide later
          </Button>
          <Button onClick={resolve} disabled={busy}>
            {keep === 'dashboard' ? `Send ours to ${robot.name}` : `Take ${robot.name}'s version`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
