import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
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
import { useRobotEmergencyStore } from '@/stores/robotEmergency';
import type { Robot } from '@/types/robot';
import {
  type AssignmentPreview,
  errorMessageOf,
  type MapRobot,
  type MapRobotState,
  type MapSummary,
  mapsApi,
} from './api';
import { assignmentSummary } from './mapList';
import { useRefreshMaps } from './queries';

const STATE_LABEL: Record<MapRobotState, string> = {
  synced: 'Up to date',
  needs_sync: 'Needs sync',
  syncing: 'Syncing',
  failed: 'Failed',
  conflict: 'Conflict',
  unsupported: "Can't receive maps",
};

const timeOf = (iso?: string) =>
  iso ? new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';

const missionList = (ids: number[]) =>
  ids.length === 1
    ? `Mission ${ids[0]}`
    : `Missions ${ids.slice(0, -1).join(', ')} and ${ids.at(-1)}`;

interface RowState {
  status: string | null;
  locked: boolean;
  note: string | null;
  warning: string | null;
  renumber: boolean;
}

const BASE: RowState = { status: null, locked: true, note: null, warning: null, renumber: false };

const heldState = (holding: MapRobot, checked: boolean): RowState => ({
  ...BASE,
  status: checked ? STATE_LABEL[holding.state] : 'Will remove',
  locked: holding.isActive,
  note: holding.isActive
    ? "Its active map, so it can't be removed here. Switch its map on the dashboard first."
    : null,
});

const clashWarning = ({ missionClashes, clashMapName }: AssignmentPreview) =>
  `${missionList(missionClashes)} already exist${missionClashes.length === 1 ? 's' : ''} on this robot${clashMapName ? ` in ${clashMapName}` : ''}. The robot runs whichever it finds first, so give this map's missions new numbers before adding it.`;

// Why a robot can't take the map now, in the order the reasons matter.
const blockedState = (robot: Robot, preview: AssignmentPreview | undefined, offline: boolean) => {
  if (preview && !preview.hasMappingBridge) return { ...BASE, status: 'No mapping bridge' };
  if (preview?.cannotReceiveMaps) return { ...BASE, status: "Can't receive maps" };
  if (offline) return { ...BASE, status: `Offline since ${timeOf(robot.lastSeen)}` };
  if (preview?.missionClashes.length) {
    return { ...BASE, renumber: true, warning: clashWarning(preview) };
  }
  return null;
};

const rowState = (
  robot: Robot,
  holding: MapRobot | undefined,
  checked: boolean,
  preview: AssignmentPreview | undefined,
  offline: boolean
): RowState => {
  if (holding) return heldState(holding, checked);
  const blocked = blockedState(robot, preview, offline);
  if (blocked) return blocked;
  return {
    ...BASE,
    locked: false,
    status: checked ? 'Will add' : null,
    note:
      checked && preview?.stemTaken
        ? `Saved on the robot as ${preview.stem}, because it already has its own ${preview.stemTaken}.`
        : null,
  };
};

function AssignRow({
  robot,
  state,
  checked,
  busy,
  onToggle,
  onRenumber,
}: {
  robot: Robot;
  state: RowState;
  checked: boolean;
  busy: boolean;
  onToggle: (robotId: string) => void;
  onRenumber: () => void;
}) {
  const id = `assign-${robot.id}`;
  return (
    <li className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3.5 py-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={busy || state.locked}
        onChange={() => onToggle(robot.id)}
        className="h-4 w-4 accent-ring-strong"
      />
      <label
        htmlFor={id}
        className={`truncate text-sm font-medium ${state.locked && !checked ? 'text-muted-foreground' : ''}`}
      >
        {robot.name}
      </label>
      {state.renumber ? (
        <Button
          size="sm"
          variant="outline"
          className="border-input-strong"
          disabled={busy}
          onClick={onRenumber}
        >
          Renumber missions
        </Button>
      ) : state.status === 'Will add' ? (
        <span className="rounded-full bg-status-active/[0.12] px-2 py-0.5 text-xs font-medium text-status-active-ink">
          Will add
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">{state.status}</span>
      )}
      {state.warning && (
        <span className="col-start-2 col-end-4 flex items-start gap-1.5 text-xs text-status-warning-ink">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          {state.warning}
        </span>
      )}
      {state.note && (
        <span className="col-start-2 col-end-4 text-xs text-muted-foreground">{state.note}</span>
      )}
    </li>
  );
}

export function AssignRobotsDialog({
  map,
  robots,
  onClose,
}: {
  map: MapSummary;
  robots: Robot[];
  onClose: () => void;
}) {
  const held = new Map(map.robots.map(robot => [robot.robotId, robot]));
  const [chosen, setChosen] = useState(() => new Set(held.keys()));
  const [busy, setBusy] = useState(false);
  const refreshMaps = useRefreshMaps();
  const queryClient = useQueryClient();
  const emergency = useRobotEmergencyStore(state => state.byRobot);
  const previewKey = [...queryKeys.maps.detail(map.id), 'assignment-preview'] as const;
  const { data: previews = [] } = useQuery({
    queryKey: previewKey,
    queryFn: () => mapsApi.assignmentPreview(map.id),
  });
  const previewOf = (robotId: string) => previews.find(preview => preview.robotId === robotId);
  const offline = (robotId: string) =>
    ['disconnected', 'error'].includes(emergency[robotId]?.connectionStatus ?? '');

  const added = robots.filter(robot => chosen.has(robot.id) && !held.has(robot.id));
  const removed = robots.filter(robot => held.has(robot.id) && !chosen.has(robot.id));

  const toggle = (robotId: string) =>
    setChosen(current => {
      const next = new Set(current);
      if (!next.delete(robotId)) next.add(robotId);
      return next;
    });

  const apply = async () => {
    setBusy(true);
    const results = await Promise.allSettled([
      ...added.map(robot => mapsApi.assign(map.id, robot.id)),
      ...removed.map(robot => mapsApi.unassign(map.id, robot.id)),
    ]);
    await refreshMaps();
    setBusy(false);
    const failed = results.filter(result => result.status === 'rejected');
    for (const result of failed) toast.error(errorMessageOf(result.reason, "Couldn't change it."));
    if (failed.length === 0) {
      toast.success('Started. Each robot shows its progress on the map.');
      onClose();
    }
  };

  const renumber = async () => {
    setBusy(true);
    try {
      await mapsApi.update(map.id, { baseRevision: map.revision, renumberMissions: true });
      await Promise.all([refreshMaps(), queryClient.invalidateQueries({ queryKey: previewKey })]);
      toast.success('Missions renumbered.');
    } catch (error) {
      toast.error(errorMessageOf(error, "Couldn't renumber the missions."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Assign {map.name}</DialogTitle>
          <DialogDescription>
            Choose the robots that should have this map. Adding a robot sends the map to it;
            removing one deletes the map from that robot.
          </DialogDescription>
        </DialogHeader>
        {robots.length === 0 ? (
          <p className="text-sm text-muted-foreground">There are no robots in this organization.</p>
        ) : (
          <ul className="max-h-[50vh] divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {robots.map(robot => (
              <AssignRow
                key={robot.id}
                robot={robot}
                checked={chosen.has(robot.id)}
                state={rowState(
                  robot,
                  held.get(robot.id),
                  chosen.has(robot.id),
                  previewOf(robot.id),
                  offline(robot.id)
                )}
                busy={busy}
                onToggle={toggle}
                onRenumber={() => void renumber()}
              />
            ))}
          </ul>
        )}
        <DialogFooter className="items-center gap-2">
          <span className="mr-auto text-sm text-muted-foreground">
            {assignmentSummary(
              added.map(robot => robot.name),
              removed.map(robot => robot.name)
            )}
          </span>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={apply} disabled={busy || (added.length === 0 && removed.length === 0)}>
            {busy ? 'Applying…' : 'Apply'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
