import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  RefreshCcw,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api';
import { evictFromCache } from '@/lib/map';
import { queryKeys } from '@/lib/query-keys';
import { getRobotDisplayStatusLabel, mergeEmergencyRuntimeIntoRobot } from '@/lib/robotStatus';
import { useAuth } from '@/stores/auth';
import { useRobotEmergencyStore } from '@/stores/robotEmergency';
import type { Robot, RobotMode } from '@/types/robot';

type EditableRobot = Partial<Robot> & {
  id?: string;
  name: string;
  ipAddress?: string;
  bridgePort?: number;
  mappingBridgePort?: number;
  missionBridgePort?: number;
  emergencyBridgePort?: number;
  mapId?: string;
  status?: RobotMode;
  channels?: Robot['channels'];
};

const DEFAULT_ROBOT: EditableRobot = {
  name: '',
  ipAddress: '',
  bridgePort: 9090,
  mappingBridgePort: 8765,
  missionBridgePort: 9487,
  emergencyBridgePort: 8766,
  mapId: '',
  status: 'UNKNOWN' as RobotMode,
};

const defaultChannels = [
  {
    name: 'odom',
    topic: '/odom_ui',
    msgType: 'nav_msgs/msg/Odometry',
    direction: 'subscribe',
    rateLimitHz: 5,
  },
  {
    name: 'laser',
    topic: '/scan_ui',
    msgType: 'sensor_msgs/msg/LaserScan',
    direction: 'subscribe',
    rateLimitHz: 3,
  },
  {
    name: 'waypoints',
    topic: '/plan_ui',
    msgType: 'nav_msgs/msg/Path',
    direction: 'subscribe',
    rateLimitHz: 2,
  },
  {
    name: 'teleop',
    topic: '/cmd_vel_ui',
    msgType: 'geometry_msgs/msg/Twist',
    direction: 'publish',
    connectionId: 'control',
  },
];

type MapSyncStatus = {
  phase:
    | 'idle'
    | 'connecting'
    | 'manifest'
    | 'skipped'
    | 'receiving'
    | 'processing'
    | 'complete'
    | 'failed';
  robotId: string;
  mapId?: string;
  mapName?: string;
  filename?: string;
  contentHash?: string;
  bytesReceived: number;
  totalBytes?: number;
  percent?: number;
  lastError?: string;
};

const MAP_SYNC_TERMINAL_PHASES = new Set<MapSyncStatus['phase']>(['complete', 'skipped', 'failed']);
const MAP_SYNC_POLL_INTERVAL_MS = 2_000;

const isTerminalMapSyncStatus = (status: MapSyncStatus | null | undefined) =>
  Boolean(status && MAP_SYNC_TERMINAL_PHASES.has(status.phase));

const sleep = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

export function RobotManagement() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();
  const isAdminUser = typeof isAdmin === 'function' ? isAdmin() : Boolean(isAdmin);
  const [robots, setRobots] = useState<Robot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<EditableRobot>(DEFAULT_ROBOT);
  const [saving, setSaving] = useState(false);
  const [maps, setMaps] = useState<{ id: string; name: string }[]>([]);
  const [channelsInput, setChannelsInput] = useState<string>('');
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [customChannels, setCustomChannels] = useState<any[]>(defaultChannels);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [mapSyncByRobotId, setMapSyncByRobotId] = useState<Record<string, MapSyncStatus>>({});
  const [refreshingMapRobotId, setRefreshingMapRobotId] = useState<string | null>(null);
  const emergencyByRobot = useRobotEmergencyStore(state => state.byRobot);
  const syncEmergencyRobots = useRobotEmergencyStore(state => state.syncRobots);
  const disconnectEmergencyRobots = useRobotEmergencyStore(state => state.disconnectAll);

  const loadRobots = useCallback(async (options?: { silent?: boolean }): Promise<Robot[]> => {
    const silent = options?.silent ?? false;
    try {
      if (!silent) setLoading(true);
      const res = await apiClient.get<{ success: boolean; data: Robot[]; message?: string }>(
        'robots'
      );
      if (res.success) {
        setRobots(res.data);
        setError(null);
        return res.data;
      } else {
        setError(res.message ?? 'Failed to load robots');
      }
    } catch (err) {
      setError('Failed to load robots');
      console.error(err);
    } finally {
      if (!silent) setLoading(false);
    }
    return [];
  }, []);

  const loadMaps = useCallback(async () => {
    try {
      const res = await apiClient.get<{ success: boolean; data: { id: string; name: string }[] }>(
        'maps'
      );
      if (res.success) {
        setMaps(res.data);
      }
    } catch (err) {
      console.error('Failed to load maps', err);
    }
  }, []);

  useEffect(() => {
    if (isAdminUser) {
      loadRobots();
      loadMaps();
    }
  }, [isAdminUser, loadRobots, loadMaps]);

  useEffect(() => {
    if (!isAdminUser) return;
    const interval = setInterval(() => {
      loadRobots({ silent: true });
    }, 30_000);
    return () => clearInterval(interval);
  }, [isAdminUser, loadRobots]);

  useEffect(() => {
    if (!isAdminUser) return;
    syncEmergencyRobots(robots);
  }, [isAdminUser, robots, syncEmergencyRobots]);

  useEffect(
    () => () => {
      disconnectEmergencyRobots();
    },
    [disconnectEmergencyRobots]
  );

  const displayedRobots = useMemo(
    () => robots.map(robot => mergeEmergencyRuntimeIntoRobot(robot, emergencyByRobot[robot.id])),
    [emergencyByRobot, robots]
  );

  const handleEdit = (robot: Robot) => {
    const next: EditableRobot = {
      id: robot.id,
      name: robot.name,
      ipAddress: robot.ipAddress ?? '',
      bridgePort: robot.bridgePort ?? 9090,
      mapId: robot.mapId ?? '',
      status: robot.status,
    };

    if (robot.mappingBridgePort !== undefined) {
      next.mappingBridgePort = robot.mappingBridgePort;
    }
    if (robot.missionBridgePort !== undefined) {
      next.missionBridgePort = robot.missionBridgePort;
    }
    if (robot.emergencyBridgePort !== undefined) {
      next.emergencyBridgePort = robot.emergencyBridgePort;
    }
    if (robot.channels) {
      next.channels = robot.channels;
    }
    setForm(next);
    const initialChannels =
      robot.channels && Array.isArray(robot.channels) ? robot.channels : defaultChannels;
    setCustomChannels(initialChannels);
    setChannelsInput(JSON.stringify(initialChannels, null, 2));
    setShowForm(true);
  };

  const resetForm = () => {
    setForm(DEFAULT_ROBOT);
    setCustomChannels(defaultChannels);
    setChannelsInput(JSON.stringify(defaultChannels, null, 2));
    setChannelsError(null);
    setAdvancedOpen(false);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name) {
      setError('Name is required');
      return;
    }
    const finalChannels = customChannels.length ? customChannels : undefined;
    setSaving(true);
    try {
      const payload: any = {
        name: form.name,
        ipAddress: form.ipAddress || undefined,
        bridgePort: form.bridgePort ? Number(form.bridgePort) : undefined,
        mappingBridgePort: form.mappingBridgePort ? Number(form.mappingBridgePort) : undefined,
        missionBridgePort: form.missionBridgePort ? Number(form.missionBridgePort) : undefined,
        emergencyBridgePort: form.emergencyBridgePort
          ? Number(form.emergencyBridgePort)
          : undefined,
        status: form.status ?? 'UNKNOWN',
        channels: finalChannels,
      };
      if (form.id) {
        await apiClient.patch(`robots/${form.id}`, payload);
        // Map assignment is managed via the active-map endpoint, not PATCH.
        if (form.mapId) {
          await apiClient.post(`robots/${form.id}/active-map`, { mapId: form.mapId });
        }
      } else {
        await apiClient.post('robots', { ...payload, mapId: form.mapId || undefined });
      }
      resetForm();
      await loadRobots();
      toast.success('Robot saved');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save robot';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleRefreshRobotMap = async () => {
    if (!form.id || refreshingMapRobotId) return;

    const robotId = form.id;
    const savedRobot = robots.find(robot => robot.id === robotId);
    const fallbackMapId = savedRobot?.mapId ?? form.mapId;
    const toastId = toast.loading('Refreshing map from robot');

    setRefreshingMapRobotId(robotId);
    try {
      const startResponse = await apiClient.post<{
        success: boolean;
        data?: MapSyncStatus;
        error?: string;
      }>(`robots/${robotId}/map-sync`);
      let status = startResponse.data ?? null;
      if (status) {
        const nextStatus = status;
        setMapSyncByRobotId(current => ({ ...current, [robotId]: nextStatus }));
      }

      while (!isTerminalMapSyncStatus(status)) {
        await sleep(MAP_SYNC_POLL_INTERVAL_MS);
        const pollResponse = await apiClient.get<{ success: boolean; data?: MapSyncStatus }>(
          `robots/${robotId}/map-sync`
        );
        status = pollResponse.data ?? null;
        if (status) {
          const nextStatus = status;
          setMapSyncByRobotId(current => ({ ...current, [robotId]: nextStatus }));
        }
      }

      if (status?.phase === 'failed') {
        throw new Error(status.lastError ?? 'Map refresh failed');
      }

      const affectedMapId = status?.mapId ?? fallbackMapId;
      if (affectedMapId) {
        evictFromCache(affectedMapId);
      }

      await queryClient.invalidateQueries({ queryKey: queryKeys.robots.lists });
      await queryClient.invalidateQueries({ queryKey: queryKeys.missions.all });

      const [nextRobots] = await Promise.all([loadRobots({ silent: true }), loadMaps()]);
      const refreshedRobot = nextRobots.find(robot => robot.id === robotId);
      if (refreshedRobot) {
        // A sync can refresh several of the robot's maps, so evict every cached map.
        for (const map of refreshedRobot.maps ?? []) {
          evictFromCache(map.id);
        }
        setForm(current =>
          current.id === robotId ? { ...current, mapId: refreshedRobot.mapId ?? '' } : current
        );
      }

      toast.success(status?.phase === 'skipped' ? 'Map metadata refreshed' : 'Map refreshed', {
        id: toastId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to refresh map';
      setError(message);
      toast.error(message, { id: toastId });
    } finally {
      setRefreshingMapRobotId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this robot?')) return;
    try {
      await apiClient.delete(`robots/${id}`, { json: {} });
      if (form.id === id) resetForm();
      await loadRobots();
      toast.success('Robot deleted');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete robot';
      setError(message);
      toast.error(message);
    }
  };

  const handleApplyChannels = () => {
    if (!channelsInput.trim()) {
      setCustomChannels([]);
      setChannelsError(null);
      toast.success('Channels cleared; defaults will be used');
      return;
    }
    try {
      const parsed = JSON.parse(channelsInput);
      if (!Array.isArray(parsed)) {
        throw new Error('Channels must be an array');
      }
      setCustomChannels(parsed);
      setChannelsError(null);
      toast.success('Channels loaded. Preview updated; Save to persist.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid channels JSON';
      setChannelsError(msg);
      toast.error(msg);
    }
  };

  const effectiveChannels = useMemo(() => customChannels, [customChannels]);
  const editingRobot = form.id ? robots.find(robot => robot.id === form.id) : null;
  const currentMapSyncStatus = form.id ? mapSyncByRobotId[form.id] : undefined;
  const isRefreshingCurrentMap = Boolean(form.id && refreshingMapRobotId === form.id);
  const refreshMapDisabled = Boolean(
    !form.id ||
      isRefreshingCurrentMap ||
      !editingRobot?.ipAddress ||
      !editingRobot?.mappingBridgePort
  );
  const refreshMapTitle = form.id
    ? !editingRobot?.ipAddress || !editingRobot?.mappingBridgePort
      ? 'Saved robot needs IP address and mapping bridge port'
      : 'Refresh map and metadata from robot'
    : 'Save the robot before refreshing map data';

  const handleEditChannelRow = (channel: any) => {
    const current = Array.isArray(customChannels) ? [...customChannels] : [];
    if (current.some(ch => ch.name === channel.name)) {
      const idx = current.findIndex(ch => ch.name === channel.name);
      current[idx] = channel;
    } else {
      current.push(channel);
    }
    setCustomChannels(current);
    setChannelsInput(JSON.stringify(current, null, 2));
    toast.success(
      `Channel "${channel.name}" loaded into editor. Apply to preview, then Save to persist.`
    );
  };

  const handleDeleteChannelRow = (channel: any) => {
    const exists = customChannels.some(ch => ch.name === channel.name);
    if (!exists) {
      toast.error(`"${channel.name}" is not in custom list.`);
      return;
    }
    if (!confirm(`Remove override for ${channel.name}?`)) return;
    const updated = customChannels.filter(ch => ch.name !== channel.name);
    setCustomChannels(updated);
    setChannelsInput(updated.length ? JSON.stringify(updated, null, 2) : '');
    toast.success(`Removed override for "${channel.name}". Apply to preview, then Save.`);
  };

  if (!isAdminUser) {
    return (
      <div className="text-center py-12">
        <h2 className="text-2xl font-bold text-destructive">Access Denied</h2>
        <p className="mt-2 text-muted-foreground">You don't have permission to access this page.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-10 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => navigate({ to: '/' })}
            className="px-3 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium focus-ring inline-flex items-center gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                resetForm();
              }}
              className="px-3 py-2 bg-secondary text-secondary-foreground rounded-md text-sm font-medium focus-ring inline-flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              New Robot
            </button>
            <button
              type="button"
              onClick={() => loadRobots()}
              className="px-3 py-2 bg-muted text-foreground rounded-md text-sm font-medium focus-ring inline-flex items-center gap-2"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>

        <h1 className="text-3xl font-bold text-foreground">Robot Management</h1>

        {error && (
          <div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded mb-4">
            {error}
            <button
              type="button"
              onClick={() => setError(null)}
              className="ml-2 text-destructive hover:text-destructive/80"
            >
              ×
            </button>
          </div>
        )}
        <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
          <div className="bg-card shadow overflow-hidden sm:rounded-md">
            {loading ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : displayedRobots.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">No robots found</div>
            ) : (
              <table className="min-w-full divide-y divide-border">
                <thead className="bg-secondary">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      IP / Port
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Map
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-background divide-y divide-border">
                  {displayedRobots.map(robot => (
                    <tr key={robot.id}>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="text-sm font-medium text-foreground">{robot.name}</div>
                        <div className="text-xs text-muted-foreground">{robot.id}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-foreground">
                        {robot.ipAddress ?? '—'}:{robot.bridgePort ?? 9090}
                        {robot.mappingBridgePort ? ` / ${robot.mappingBridgePort}` : ''}
                        {robot.missionBridgePort ? ` / ${robot.missionBridgePort}` : ''}
                        {robot.emergencyBridgePort ? ` / ${robot.emergencyBridgePort}` : ''}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-foreground">
                        {robot.maps?.find(m => m.isActive)?.name ??
                          maps.find(m => m.id === robot.mapId)?.name ??
                          '—'}
                        {robot.maps && robot.maps.length > 1 ? (
                          <span className="ml-1 text-xs text-muted-foreground">
                            (+{robot.maps.length - 1})
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-muted-foreground">
                        {getRobotDisplayStatusLabel(robot)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-medium space-x-2">
                        <button
                          type="button"
                          onClick={() =>
                            handleEdit(robots.find(item => item.id === robot.id) ?? robot)
                          }
                          className="text-primary hover:text-primary/80 focus-ring inline-flex items-center gap-1"
                        >
                          <Save className="h-4 w-4 rotate-90" />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(robot.id)}
                          className="text-destructive hover:text-destructive/80 focus-ring inline-flex items-center gap-1"
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="bg-card shadow rounded-md p-4 space-y-4 min-h-[520px]">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">
                {form.id ? 'Edit Robot' : showForm ? 'New Robot' : 'Robot Form'}
              </h2>
              {form.id && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  Clear
                </button>
              )}
            </div>
            {showForm ? (
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-sm text-muted-foreground">Name</label>
                  <input
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-ring"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Robot name"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm text-muted-foreground">IP Address</label>
                  <input
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-ring"
                    value={form.ipAddress ?? ''}
                    onChange={e => setForm(f => ({ ...f, ipAddress: e.target.value }))}
                    placeholder="192.168.1.230"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm text-muted-foreground">Bridge Port</label>
                  <input
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-ring"
                    value={form.bridgePort ?? 9090}
                    onChange={e =>
                      setForm(f => ({
                        ...f,
                        bridgePort: e.target.value ? Number(e.target.value) : undefined,
                      }))
                    }
                    type="number"
                    min={1}
                    max={65535}
                    placeholder="9090"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm text-muted-foreground">Mapping Bridge Port</label>
                  <input
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-ring"
                    value={form.mappingBridgePort ?? ''}
                    onChange={e =>
                      setForm(f => ({
                        ...f,
                        mappingBridgePort: e.target.value ? Number(e.target.value) : undefined,
                      }))
                    }
                    type="number"
                    min={1}
                    max={65535}
                    placeholder="8765"
                  />
                  <p className="text-xs text-muted-foreground">
                    Optional mapping ROS bridge on the same IP (e.g. 8765). Use channel connectionId
                    ("mapping") to target this socket.
                  </p>
                </div>
                <div className="space-y-1">
                  <label className="text-sm text-muted-foreground">Mission Bridge Port</label>
                  <input
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-ring"
                    value={form.missionBridgePort ?? ''}
                    onChange={e =>
                      setForm(f => ({
                        ...f,
                        missionBridgePort: e.target.value ? Number(e.target.value) : undefined,
                      }))
                    }
                    type="number"
                    min={1}
                    max={65535}
                    placeholder="9487"
                  />
                  <p className="text-xs text-muted-foreground">
                    Optional mission-control bridge on the same IP (e.g. 9487). Used for mission
                    show-up and start commands.
                  </p>
                </div>
                <div className="space-y-1">
                  <label className="text-sm text-muted-foreground">Emergency Bridge Port</label>
                  <input
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-ring"
                    value={form.emergencyBridgePort ?? ''}
                    onChange={e =>
                      setForm(f => ({
                        ...f,
                        emergencyBridgePort: e.target.value ? Number(e.target.value) : undefined,
                      }))
                    }
                    type="number"
                    min={1}
                    max={65535}
                    placeholder="8766"
                  />
                  <p className="text-xs text-muted-foreground">
                    Optional direct emergency bridge on the same IP (e.g. 8766). Used by the
                    dashboard for emergency stop control and backend sync.
                  </p>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-sm text-muted-foreground">Map</label>
                    {form.id && (
                      <button
                        type="button"
                        onClick={handleRefreshRobotMap}
                        disabled={refreshMapDisabled}
                        title={refreshMapTitle}
                        aria-label="Refresh map and metadata from robot"
                        className="inline-flex h-7 w-7 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground focus-ring disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <RefreshCcw
                          className={`h-3.5 w-3.5 ${isRefreshingCurrentMap ? 'animate-spin' : ''}`}
                        />
                      </button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <select
                      className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus-ring"
                      value={form.mapId ?? ''}
                      onChange={e => setForm(f => ({ ...f, mapId: e.target.value || undefined }))}
                    >
                      <option value="">Select a map (optional)</option>
                      {(form.id
                        ? (robots.find(r => r.id === form.id)?.maps ?? []).map(m => ({
                            id: m.id,
                            name: m.name ?? m.id,
                          }))
                        : maps
                      ).map(map => (
                        <option key={map.id} value={map.id}>
                          {map.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {currentMapSyncStatus && form.id && (
                    <div className="text-xs text-muted-foreground">
                      {currentMapSyncStatus.phase === 'failed'
                        ? (currentMapSyncStatus.lastError ?? 'Map refresh failed')
                        : currentMapSyncStatus.phase === 'skipped'
                          ? 'Image unchanged; metadata checked'
                          : currentMapSyncStatus.phase === 'complete'
                            ? 'Map refresh complete'
                            : `Refreshing map${
                                typeof currentMapSyncStatus.percent === 'number'
                                  ? ` (${Math.round(currentMapSyncStatus.percent)}%)`
                                  : ''
                              }`}
                    </div>
                  )}
                </div>
                <div className="space-y-1">
                  <label className="text-sm text-muted-foreground">Status</label>
                  <select
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-ring"
                    value={form.status ?? 'UNKNOWN'}
                    onChange={e => setForm(f => ({ ...f, status: e.target.value as RobotMode }))}
                  >
                    <option value="MISSION">MISSION</option>
                    <option value="DOCKING">DOCKING</option>
                    <option value="CHARGING">CHARGING</option>
                    <option value="SW_EMERGENCY">SW_EMERGENCY</option>
                    <option value="HW_EMERGENCY">HW_EMERGENCY</option>
                    <option value="TELEOP">TELEOP</option>
                    <option value="AUTONOMOUS">AUTONOMOUS</option>
                    <option value="HRI">HRI</option>
                    <option value="UNKNOWN">UNKNOWN</option>
                  </select>
                </div>

                <div className="border border-border rounded-md">
                  <button
                    type="button"
                    onClick={() => setAdvancedOpen(o => !o)}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium bg-muted/40 hover:bg-muted/60 transition-colors"
                  >
                    <span>Advanced (Channels)</span>
                    {advancedOpen ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </button>
                  {advancedOpen && (
                    <div className="p-3 space-y-3">
                      <div className="text-sm font-medium text-foreground">Channel Config</div>
                      <div className="space-y-1">
                        <label className="text-sm text-muted-foreground">Channels (JSON)</label>
                        <textarea
                          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-ring h-32 font-mono"
                          value={channelsInput}
                          onChange={e => setChannelsInput(e.target.value)}
                          placeholder='[{"name":"odom","topic":"/odom_ui","msgType":"nav_msgs/Odometry","direction":"subscribe"}]'
                        />
                        <div className="text-xs text-muted-foreground">
                          Provide an array of channels. Leave blank to start from defaults.
                          Edit/Delete rows below to change the working set; Save to persist to the
                          robot. Use <code>connectionId</code> (e.g. "default", "control", or
                          "mapping") to pick which ROS bridge port to use.
                        </div>
                        {channelsError && (
                          <div className="text-xs text-destructive mt-1">{channelsError}</div>
                        )}
                      </div>

                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={handleApplyChannels}
                          className="px-3 py-2 bg-muted text-foreground rounded-md text-sm font-medium focus-ring"
                        >
                          Apply Channels
                        </button>
                      </div>

                      <div className="space-y-2">
                        <div className="text-sm font-medium text-foreground">
                          Effective Channels
                        </div>
                        <div className="rounded-md border border-border bg-muted/30">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-muted-foreground bg-muted/40">
                                <th className="px-2 py-1 text-left">Name</th>
                                <th className="px-2 py-1 text-left">Direction</th>
                                <th className="px-2 py-1 text-left">Conn</th>
                                <th className="px-2 py-1 text-left">Topic</th>
                                <th className="px-2 py-1 text-left">Type</th>
                                <th className="px-2 py-1 text-left">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {effectiveChannels.map(ch => (
                                <tr key={ch.name} className="border-t border-border/60">
                                  <td className="px-2 py-1 font-medium">{ch.name}</td>
                                  <td className="px-2 py-1">{ch.direction}</td>
                                  <td className="px-2 py-1 text-muted-foreground">
                                    {ch.connectionId ?? 'default'}
                                  </td>
                                  <td className="px-2 py-1">{ch.topic}</td>
                                  <td className="px-2 py-1 text-muted-foreground">{ch.msgType}</td>
                                  <td className="px-2 py-1">
                                    <div className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => handleEditChannelRow(ch)}
                                        className="p-1 rounded hover:bg-muted focus-ring"
                                        title="Edit channel"
                                      >
                                        <Pencil className="h-4 w-4" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteChannelRow(ch)}
                                        className="p-1 rounded hover:bg-muted focus-ring"
                                        title="Delete channel"
                                      >
                                        <X className="h-4 w-4" />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 focus-ring disabled:opacity-60"
                >
                  <Save className="h-4 w-4" />
                  {form.id ? 'Update Robot' : 'Create Robot'}
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                Select a robot to edit or click "New Robot" to create one.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
