import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { PERMISSIONS } from '@tensrai/shared';
import { ArrowLeft, Plus, RefreshCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api';
import { evictFromCache } from '@/lib/map/loadMapAssets';
import { queryKeys } from '@/lib/query-keys';
import { mergeEmergencyRuntimeIntoRobot } from '@/lib/robotStatus';
import { useAuth } from '@/stores/auth';
import { useRobotEmergencyStore } from '@/stores/robotEmergency';
import type { Robot } from '@/types/robot';
import { useChannelEditor } from '../hooks/useChannelEditor';
import { type MapSyncStatus, useMapSync } from '../hooks/useMapSync';
import {
  DEFAULT_CHANNELS,
  DEFAULT_ROBOT,
  type EditableRobot,
  type MapOption,
  type RobotPayload,
  toRobotPayload,
} from '../robotFormModel';
import { AdminNav } from './AdminNav';
import { RobotForm } from './RobotForm';
import { RobotTable } from './RobotTable';

const saveRobot = async (form: EditableRobot, payload: RobotPayload, robots: Robot[]) => {
  if (!form.id) {
    await apiClient.post('robots', { ...payload, mapId: form.mapId || undefined });
    return;
  }
  await apiClient.patch(`robots/${form.id}`, payload);
  // Map assignment is managed via the active-map endpoint, not PATCH. That also pins the map,
  // so saving an unrelated edit must not turn off auto-follow.
  const savedMapId = robots.find(robot => robot.id === form.id)?.mapId ?? '';
  if (form.mapId && form.mapId !== savedMapId) {
    await apiClient.post(`robots/${form.id}/active-map`, { mapId: form.mapId });
  }
};

const evictSyncedMapFromCache = (status: MapSyncStatus | null, fallbackMapId?: string) => {
  const affectedMapId = status?.mapId ?? fallbackMapId;
  if (affectedMapId) {
    evictFromCache(affectedMapId);
  }
};

// A sync can refresh several of the robot's maps, so evict every cached map.
const evictRobotMapsFromCache = (robot: Robot) => {
  for (const map of robot.maps ?? []) {
    evictFromCache(map.id);
  }
};

const mapRefreshedMessage = (status: MapSyncStatus | null) =>
  status?.phase === 'skipped' ? 'Map metadata refreshed' : 'Map refreshed';

export function RobotManagement() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAdmin, hasPermission, user } = useAuth();
  const isStaff = hasPermission(PERMISSIONS.STAFF_CONSOLE);
  const [addressStatusByIp, setAddressStatusByIp] = useState<Record<string, string>>({});
  const isAdminUser = typeof isAdmin === 'function' ? isAdmin() : Boolean(isAdmin);
  const [robots, setRobots] = useState<Robot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<EditableRobot>(DEFAULT_ROBOT);
  const [saving, setSaving] = useState(false);
  const [maps, setMaps] = useState<MapOption[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [refreshingMapRobotId, setRefreshingMapRobotId] = useState<string | null>(null);
  const channelEditor = useChannelEditor();
  const { statusByRobotId: mapSyncByRobotId, runMapSync } = useMapSync();
  const emergencyByRobot = useRobotEmergencyStore(state => state.byRobot);
  const syncEmergencyRobots = useRobotEmergencyStore(state => state.syncRobots);
  const disconnectEmergencyRobots = useRobotEmergencyStore(state => state.disconnectAll);

  // The dashboard shows this list from the cache as soon as it opens, so it has to be right before
  // anyone goes back. Without refetchType it would only be marked stale while the dashboard is closed.
  const refreshDashboardData = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.robots.lists, refetchType: 'all' }),
        queryClient.invalidateQueries({ queryKey: queryKeys.missions.all }),
      ]),
    [queryClient]
  );

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

  const loadAddressStatuses = useCallback(async () => {
    try {
      const res = await apiClient.get<{ data: { ip: string; status: string }[] }>(
        'robots/addresses'
      );
      setAddressStatusByIp(
        Object.fromEntries(res.data.map(address => [address.ip, address.status]))
      );
    } catch (err) {
      console.error('Failed to load robot addresses', err);
    }
  }, []);

  const loadMaps = useCallback(async () => {
    try {
      const res = await apiClient.get<{ success: boolean; data: MapOption[] }>('maps');
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
      loadAddressStatuses();
    }
  }, [isAdminUser, loadRobots, loadMaps, loadAddressStatuses]);

  useEffect(() => {
    if (!isAdminUser) return;
    const interval = setInterval(() => {
      loadRobots({ silent: true });
      loadAddressStatuses();
    }, 30_000);
    return () => clearInterval(interval);
  }, [isAdminUser, loadRobots, loadAddressStatuses]);

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
    channelEditor.load(
      robot.channels && Array.isArray(robot.channels) ? robot.channels : DEFAULT_CHANNELS
    );
    setShowForm(true);
  };

  const resetForm = () => {
    setForm(DEFAULT_ROBOT);
    channelEditor.reset();
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name) {
      setError('Name is required');
      return;
    }
    setSaving(true);
    try {
      await saveRobot(form, toRobotPayload(form, channelEditor.channels), robots);
      resetForm();
      await Promise.all([loadRobots(), loadAddressStatuses(), refreshDashboardData()]);
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
      const status = await runMapSync(robotId);
      evictSyncedMapFromCache(status, fallbackMapId);

      await refreshDashboardData();

      const [nextRobots] = await Promise.all([loadRobots({ silent: true }), loadMaps()]);
      const refreshedRobot = nextRobots.find(robot => robot.id === robotId);
      if (refreshedRobot) {
        evictRobotMapsFromCache(refreshedRobot);
        setForm(current =>
          current.id === robotId ? { ...current, mapId: refreshedRobot.mapId ?? '' } : current
        );
      }

      toast.success(mapRefreshedMessage(status), { id: toastId });
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
      await Promise.all([loadRobots(), refreshDashboardData()]);
      toast.success('Robot deleted');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete robot';
      setError(message);
      toast.error(message);
    }
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
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => navigate({ to: '/' })}
              className="px-3 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium focus-ring inline-flex items-center gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Dashboard
            </button>
            <AdminNav />
          </div>
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
          <RobotTable
            robots={displayedRobots}
            loading={loading}
            maps={maps}
            addressStatusByIp={addressStatusByIp}
            canMoveRobots={isStaff}
            currentOrgId={user?.orgId}
            onEdit={robot => handleEdit(robots.find(item => item.id === robot.id) ?? robot)}
            onDelete={handleDelete}
            onMoved={() => Promise.all([loadRobots(), refreshDashboardData()])}
          />

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
              <RobotForm
                form={form}
                setForm={setForm}
                editingRobot={robots.find(robot => robot.id === form.id)}
                maps={maps}
                mapSyncStatus={form.id ? mapSyncByRobotId[form.id] : undefined}
                isRefreshingMap={Boolean(form.id && refreshingMapRobotId === form.id)}
                onRefreshMap={handleRefreshRobotMap}
                channelEditor={channelEditor}
                saving={saving}
                onSave={handleSave}
              />
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
