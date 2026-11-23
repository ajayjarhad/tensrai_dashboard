import { useNavigate } from '@tanstack/react-router';
import { PERMISSIONS } from '@tensrai/shared';
import { Download, Info, Merge, MoreHorizontal, Search, Send, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useRobots } from '@/features/robot-map/hooks/useRobots';
import { useAuth } from '@/stores/auth';
import type { Robot } from '@/types/robot';
import { AssignRobotsDialog } from './AssignRobotsDialog';
import { errorMessageOf, type MapRobot, type MapSummary, mapsApi } from './api';
import { ConflictDialog } from './ConflictDialog';
import { ImportFromRobotDialog, RenameMapDialog } from './MapDialogs';
import {
  type Can,
  MapCard,
  MapRow,
  Menu,
  MenuItem,
  type OpenDialog,
  type RowProps,
} from './MapRows';
import { attentionSentence, filterMaps, mapsNeedingAttention, robotsBehind } from './mapList';
import { useMaps, useRefreshMaps } from './queries';
import { UploadMapDialog } from './UploadMapDialog';

const startedCount = (results: { started: boolean; error?: string }[]) => {
  const refused = results.filter(result => !result.started);
  for (const result of refused) toast.error(result.error ?? 'The sync did not start.');
  return results.length - refused.length;
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function PageHeader({
  can,
  summary,
  onOpen,
}: {
  can: Can;
  summary: string;
  onOpen: (dialog: OpenDialog) => void;
}) {
  const navigate = useNavigate();
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        <h1 className="text-3xl font-bold">Maps</h1>
        <p className="hidden max-w-[620px] text-muted-foreground sm:block">
          The maps your robots navigate by. Edit them here, then sync the latest version to the
          robots that use them.
        </p>
        <p className="text-sm text-muted-foreground sm:hidden">{summary}</p>
      </div>
      <div className="flex items-center gap-2">
        {(can.sync || can.edit) && (
          <Menu
            label="More map actions"
            trigger={
              <span className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-input-strong bg-background px-3 text-sm font-medium hover:bg-muted focus-ring-strong sm:px-4">
                <MoreHorizontal className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">More</span>
              </span>
            }
          >
            {can.sync && (
              <MenuItem
                icon={Download}
                label="Import from robot"
                hint="Bring in maps a robot made itself"
                onSelect={() => onOpen({ kind: 'import' })}
              />
            )}
            {can.edit && (
              <MenuItem
                icon={Merge}
                label="Merge maps"
                hint="Join maps of neighbouring areas into one new map"
                onSelect={() => void navigate({ to: '/maps/merge' })}
              />
            )}
          </Menu>
        )}
        {can.edit && (
          <Button onClick={() => onOpen({ kind: 'upload' })}>
            <Upload aria-hidden />
            Upload<span className="hidden sm:inline"> map</span>
          </Button>
        )}
      </div>
    </div>
  );
}

function AttentionBanner({
  maps,
  onSyncBehind,
}: {
  maps: MapSummary[];
  onSyncBehind: (() => void) | undefined;
}) {
  return (
    <output className="grid grid-cols-[16px_1fr] items-center gap-3 rounded-lg border border-border p-4">
      <Info className="h-4 w-4" aria-hidden />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          <strong>{plural(maps.length, 'map needs', 'maps need')} attention.</strong>{' '}
          {attentionSentence(maps)}
        </p>
        {onSyncBehind && (
          <Button
            size="sm"
            variant="outline"
            className="border-input-strong"
            onClick={onSyncBehind}
          >
            <Send aria-hidden />
            Sync all that need it
          </Button>
        )}
      </div>
    </output>
  );
}

const COLUMNS = ['Map', 'Size', 'Robots', 'Modified'] as const;

function MapsBody({
  status,
  onRetry,
  rows,
}: {
  status: 'error' | 'loading' | 'empty' | 'ready';
  onRetry: () => void;
  rows: RowProps[];
}) {
  if (status === 'error') {
    return (
      <div role="alert" className="flex items-center gap-3 rounded-lg border border-border p-4">
        <span className="text-sm">Couldn't load the maps.</span>
        <Button size="sm" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }
  if (status === 'loading') return <p className="text-sm text-muted-foreground">Loading maps…</p>;
  if (status === 'empty') {
    return (
      <div className="rounded-lg border border-dashed border-input-strong p-10 text-center">
        <p className="font-medium">No maps yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Import one from a robot, or upload one saved by your mapping tools.
        </p>
      </div>
    );
  }
  return (
    <>
      <div className="hidden overflow-x-auto rounded-md bg-card shadow sm:block lg:overflow-visible">
        <table className="w-full min-w-[900px] border-collapse">
          <thead className="bg-secondary">
            <tr className="text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {COLUMNS.map(column => (
                <th key={column} scope="col" className="px-4 py-3">
                  {column}
                </th>
              ))}
              <th scope="col" className="px-4 py-3">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="bg-background text-sm">
            {rows.map(row => (
              <MapRow key={row.map.id} {...row} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 sm:hidden">
        {rows.map(row => (
          <MapCard key={row.map.id} {...row} />
        ))}
        <p className="flex gap-2 rounded-lg bg-muted p-3 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Editing and merging maps need a larger screen. On a phone you can assign maps, sync them
          and resolve conflicts.
        </p>
      </div>
    </>
  );
}

function OpenDialogs({
  open,
  maps,
  robots,
  onClose,
}: {
  open: OpenDialog;
  maps: MapSummary[];
  robots: Robot[];
  onClose: () => void;
}) {
  if (!open) return null;
  if (open.kind === 'upload') return <UploadMapDialog maps={maps} onClose={onClose} />;
  if (open.kind === 'import') return <ImportFromRobotDialog robots={robots} onClose={onClose} />;
  const map = maps.find(candidate => candidate.id === open.mapId);
  if (!map) return null;
  if (open.kind === 'assign')
    return <AssignRobotsDialog map={map} robots={robots} onClose={onClose} />;
  if (open.kind === 'rename') return <RenameMapDialog map={map} onClose={onClose} />;
  const robot = map.robots.find(candidate => candidate.robotId === open.robotId);
  return robot ? <ConflictDialog map={map} robot={robot} onClose={onClose} /> : null;
}

function Filters({
  search,
  robotFilter,
  robotOptions,
  counts,
  onSearch,
  onRobot,
}: {
  search: string;
  robotFilter: string;
  robotOptions: [string, string][];
  counts: string;
  onSearch: (value: string) => void;
  onRobot: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="relative flex-[1_1_280px] sm:max-w-[360px]" htmlFor="maps-search">
        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden />
        <input
          id="maps-search"
          type="search"
          placeholder="Search maps"
          value={search}
          onChange={event => onSearch(event.target.value)}
          className="h-10 w-full rounded-md border border-input-strong bg-background pl-9 pr-3 text-sm focus-ring-strong"
        />
      </label>
      <select
        aria-label="Robot"
        value={robotFilter}
        onChange={event => onRobot(event.target.value)}
        className="hidden h-10 w-[200px] rounded-md border border-input-strong bg-background px-3 text-sm focus-ring-strong sm:block"
      >
        <option value="">All robots</option>
        {robotOptions.map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
      <span className="hidden text-sm text-muted-foreground sm:inline">{counts}</span>
    </div>
  );
}

export function MapListPage() {
  const { hasPermission } = useAuth();
  const can = {
    edit: hasPermission(PERMISSIONS.MAPS_EDIT),
    sync: hasPermission(PERMISSIONS.MAPS_SYNC),
    remove: hasPermission(PERMISSIONS.MAPS_DELETE),
  };
  const { data: maps = [], isLoading, isError, refetch } = useMaps();
  const { data: robots = [] } = useRobots();
  const refreshMaps = useRefreshMaps();
  const [search, setSearch] = useState('');
  const [robotFilter, setRobotFilter] = useState('');
  const [open, setOpen] = useState<OpenDialog>(null);

  const shown = useMemo(() => filterMaps(maps, search, robotFilter), [maps, search, robotFilter]);
  const attention = mapsNeedingAttention(maps);
  const behind = robotsBehind(maps);
  const robotOptions = useMemo(
    () =>
      [...new Map(maps.flatMap(map => map.robots).map(robot => [robot.robotId, robot.name]))].sort(
        (a, b) => a[1].localeCompare(b[1])
      ),
    [maps]
  );

  const run = async (work: () => Promise<unknown>, fallback: string) => {
    try {
      await work();
    } catch (error) {
      toast.error(errorMessageOf(error, fallback));
    } finally {
      await refreshMaps();
    }
  };

  const onChipAction = (map: MapSummary, robot: MapRobot) => {
    if (robot.state === 'conflict') {
      setOpen({ kind: 'conflict', mapId: map.id, robotId: robot.robotId });
      return;
    }
    void run(
      () =>
        robot.assigning
          ? mapsApi.assign(map.id, robot.robotId)
          : mapsApi.push(map.id, [robot.robotId]).then(startedCount),
      'The sync did not start.'
    );
  };

  const syncBehind = () =>
    run(async () => {
      const results = await Promise.allSettled(behind.map(robotId => mapsApi.pushRobot(robotId)));
      for (const result of results) {
        if (result.status === 'rejected') {
          toast.error(errorMessageOf(result.reason, 'The sync did not start.'));
        }
      }
      const started = results.filter(
        result => result.status === 'fulfilled' && result.value
      ).length;
      if (started) toast.success(`Syncing ${plural(started, 'robot', 'robots')}`);
    }, 'The sync did not start.');

  const syncMap = (map: MapSummary) =>
    run(async () => {
      const started = startedCount(await mapsApi.push(map.id));
      if (started) toast.success(`Syncing ${map.name} to ${plural(started, 'robot', 'robots')}`);
    }, 'The sync did not start.');

  const deleteMap = (map: MapSummary) => {
    if (!window.confirm(`Delete ${map.name}? This can't be undone.`)) return;
    void run(async () => {
      await mapsApi.remove(map.id);
      toast.success(`${map.name} deleted`);
    }, "Couldn't delete the map.");
  };

  const rows: RowProps[] = shown.map(map => ({
    map,
    can,
    onOpen: setOpen,
    onChipAction,
    onSync: syncMap,
    onDelete: deleteMap,
  }));
  const status = isError ? 'error' : isLoading ? 'loading' : maps.length === 0 ? 'empty' : 'ready';

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-4 py-8 sm:px-8 sm:py-10">
      <PageHeader
        can={can}
        summary={`${plural(maps.length, 'map', 'maps')} · ${attention.length} need attention`}
        onOpen={setOpen}
      />
      {attention.length > 0 && (
        <AttentionBanner
          maps={attention}
          onSyncBehind={can.sync && behind.length > 0 ? syncBehind : undefined}
        />
      )}
      <Filters
        search={search}
        robotFilter={robotFilter}
        robotOptions={robotOptions}
        counts={`${plural(shown.length, 'map', 'maps')} · ${plural(robots.length, 'robot', 'robots')}`}
        onSearch={setSearch}
        onRobot={setRobotFilter}
      />
      <MapsBody status={status} onRetry={() => void refetch()} rows={rows} />
      <OpenDialogs open={open} maps={maps} robots={robots} onClose={() => setOpen(null)} />
    </div>
  );
}
