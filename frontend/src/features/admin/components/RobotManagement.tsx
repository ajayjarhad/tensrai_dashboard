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
import { useAuth } from '@/stores/auth';
import type { Robot, RobotMode } from '@/types/robot';

type EditableRobot = Partial<Robot> & {
  id?: string;
  name: string;
  ipAddress?: string;
  bridgePort?: number;
  mapId?: string;
  status?: RobotMode;
  channels?: Robot['channels'];
};

const DEFAULT_ROBOT: EditableRobot = {
  name: '',
  ipAddress: '',
  bridgePort: 9090,
  mapId: '',
  status: 'UNKNOWN' as RobotMode,
};

const defaultChannels = [
  {
    name: 'odom',
    topic: '/odom',
    msgType: 'nav_msgs/msg/Odometry',
    direction: 'subscribe',
    rateLimitHz: 5,
  },
  {
    name: 'laser',
    topic: '/scan',
    msgType: 'sensor_msgs/msg/LaserScan',
    direction: 'subscribe',
    rateLimitHz: 10,
  },
  {
    name: 'waypoints',
    topic: '/plan',
    msgType: 'nav_msgs/msg/Path',
    direction: 'subscribe',
    rateLimitHz: 2,
  },
  {
    name: 'teleop',
    topic: '/cmd_vel',
    msgType: 'geometry_msgs/msg/Twist',
    direction: 'publish',
  },
];

export function RobotManagement() {
  const navigate = useNavigate();
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

  const loadRobots = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiClient.get<{ success: boolean; data: Robot[]; message?: string }>(
        'robots'
      );
      if (res.success) {
        setRobots(res.data);
        setError(null);
      } else {
        setError(res.message ?? 'Failed to load robots');
      }
    } catch (err) {
      setError('Failed to load robots');
      console.error(err);
    } finally {
      setLoading(false);
    }
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

  const handleEdit = (robot: Robot) => {
    const next: EditableRobot = {
      id: robot.id,
      name: robot.name,
      ipAddress: robot.ipAddress ?? '',
      bridgePort: robot.bridgePort ?? 9090,
      mapId: robot.mapId ?? '',
      status: robot.status,
    };
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
        mapId: form.mapId || undefined,
        status: form.status ?? 'UNKNOWN',
        channels: finalChannels,
      };
      if (form.id) {
        await apiClient.patch(`robots/${form.id}`, payload);
      } else {
        await apiClient.post('robots', payload);
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
              onClick={loadRobots}
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
            ) : robots.length === 0 ? (
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
                  {robots.map(robot => (
                    <tr key={robot.id}>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="text-sm font-medium text-foreground">{robot.name}</div>
                        <div className="text-xs text-muted-foreground">{robot.id}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-foreground">
                        {robot.ipAddress ?? '—'}:{robot.bridgePort ?? 9090}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-foreground">
                        {maps.find(m => m.id === robot.mapId)?.name ?? '—'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-muted-foreground">
                        {robot.status}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-medium space-x-2">
                        <button
                          type="button"
                          onClick={() => handleEdit(robot)}
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
                  <label className="text-sm text-muted-foreground">Map</label>
                  <select
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-ring"
                    value={form.mapId ?? ''}
                    onChange={e => setForm(f => ({ ...f, mapId: e.target.value || undefined }))}
                  >
                    <option value="">Select a map (optional)</option>
                    {maps.map(map => (
                      <option key={map.id} value={map.id}>
                        {map.name}
                      </option>
                    ))}
                  </select>
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
                          placeholder='[{"name":"odom","topic":"/odom","msgType":"nav_msgs/Odometry","direction":"subscribe"}]'
                        />
                        <div className="text-xs text-muted-foreground">
                          Provide an array of channels. Leave blank to start from defaults.
                          Edit/Delete rows below to change the working set; Save to persist to the
                          robot.
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
