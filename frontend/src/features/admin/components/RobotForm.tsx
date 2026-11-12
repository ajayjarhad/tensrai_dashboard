import { RefreshCcw, Save } from 'lucide-react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { Robot, RobotMode } from '@/types/robot';
import type { ChannelEditorState } from '../hooks/useChannelEditor';
import type { MapSyncStatus } from '../hooks/useMapSync';
import type { EditableRobot, MapOption } from '../robotFormModel';
import { ChannelEditor } from './ChannelEditor';

const FIELD_CLASS =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-ring';

const ROBOT_MODES = [
  'MISSION',
  'DOCKING',
  'CHARGING',
  'SW_EMERGENCY',
  'HW_EMERGENCY',
  'TELEOP',
  'AUTONOMOUS',
  'HRI',
  'UNKNOWN',
];

type PortKey = 'bridgePort' | 'mappingBridgePort' | 'missionBridgePort' | 'emergencyBridgePort';

type RobotFormProps = {
  form: EditableRobot;
  setForm: Dispatch<SetStateAction<EditableRobot>>;
  editingRobot: Robot | undefined;
  maps: MapOption[];
  mapSyncStatus: MapSyncStatus | undefined;
  isRefreshingMap: boolean;
  onRefreshMap: () => void;
  channelEditor: ChannelEditorState;
  saving: boolean;
  onSave: () => void;
};

function PortField({
  label,
  portKey,
  value,
  placeholder,
  hint,
  setForm,
}: {
  label: string;
  portKey: PortKey;
  value: number | string;
  placeholder: string;
  hint?: ReactNode;
  setForm: RobotFormProps['setForm'];
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm text-muted-foreground">{label}</label>
      <input
        className={FIELD_CLASS}
        value={value}
        onChange={e =>
          setForm(f => ({
            ...f,
            [portKey]: e.target.value ? Number(e.target.value) : undefined,
          }))
        }
        type="number"
        min={1}
        max={65535}
        placeholder={placeholder}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

const mapSyncMessage = (status: MapSyncStatus) => {
  if (status.phase === 'failed') return status.lastError ?? 'Map refresh failed';
  if (status.phase === 'skipped') return 'Image unchanged; metadata checked';
  if (status.phase === 'complete') return 'Map refresh complete';
  return `Refreshing map${
    typeof status.percent === 'number' ? ` (${Math.round(status.percent)}%)` : ''
  }`;
};

function MapField({
  form,
  setForm,
  editingRobot,
  maps,
  mapSyncStatus,
  isRefreshingMap,
  onRefreshMap,
}: Pick<
  RobotFormProps,
  | 'form'
  | 'setForm'
  | 'editingRobot'
  | 'maps'
  | 'mapSyncStatus'
  | 'isRefreshingMap'
  | 'onRefreshMap'
>) {
  const canReachRobot = Boolean(editingRobot?.ipAddress && editingRobot?.mappingBridgePort);
  const mapOptions = form.id
    ? (editingRobot?.maps ?? []).map(m => ({ id: m.id, name: m.name ?? m.id }))
    : maps;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm text-muted-foreground">Map</label>
        {form.id && (
          <button
            type="button"
            onClick={onRefreshMap}
            disabled={isRefreshingMap || !canReachRobot}
            title={
              canReachRobot
                ? 'Refresh map and metadata from robot'
                : 'Saved robot needs IP address and mapping bridge port'
            }
            aria-label="Refresh map and metadata from robot"
            className="inline-flex h-7 w-7 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground focus-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCcw className={`h-3.5 w-3.5 ${isRefreshingMap ? 'animate-spin' : ''}`} />
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
          {mapOptions.map(map => (
            <option key={map.id} value={map.id}>
              {map.name}
            </option>
          ))}
        </select>
      </div>
      {mapSyncStatus && (
        <div className="text-xs text-muted-foreground">{mapSyncMessage(mapSyncStatus)}</div>
      )}
    </div>
  );
}

export function RobotForm({
  form,
  setForm,
  editingRobot,
  maps,
  mapSyncStatus,
  isRefreshingMap,
  onRefreshMap,
  channelEditor,
  saving,
  onSave,
}: RobotFormProps) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label className="text-sm text-muted-foreground">Name</label>
        <input
          className={FIELD_CLASS}
          value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          placeholder="Robot name"
        />
      </div>
      <div className="space-y-1">
        <label className="text-sm text-muted-foreground">IP Address</label>
        <input
          className={FIELD_CLASS}
          value={form.ipAddress ?? ''}
          onChange={e => setForm(f => ({ ...f, ipAddress: e.target.value }))}
          placeholder="192.168.1.230"
        />
      </div>
      <PortField
        label="Bridge Port"
        portKey="bridgePort"
        value={form.bridgePort ?? 9090}
        placeholder="9090"
        setForm={setForm}
      />
      <PortField
        label="Mapping Bridge Port"
        portKey="mappingBridgePort"
        value={form.mappingBridgePort ?? ''}
        placeholder="8765"
        hint={
          'Optional mapping ROS bridge on the same IP (e.g. 8765). Use channel connectionId ("mapping") to target this socket.'
        }
        setForm={setForm}
      />
      <PortField
        label="Mission Bridge Port"
        portKey="missionBridgePort"
        value={form.missionBridgePort ?? ''}
        placeholder="9487"
        hint="Optional mission-control bridge on the same IP (e.g. 9487). Used for mission show-up and start commands."
        setForm={setForm}
      />
      <PortField
        label="Emergency Bridge Port"
        portKey="emergencyBridgePort"
        value={form.emergencyBridgePort ?? ''}
        placeholder="8766"
        hint="Optional direct emergency bridge on the same IP (e.g. 8766). Used by the dashboard for emergency stop control and backend sync."
        setForm={setForm}
      />
      <MapField
        form={form}
        setForm={setForm}
        editingRobot={editingRobot}
        maps={maps}
        mapSyncStatus={mapSyncStatus}
        isRefreshingMap={isRefreshingMap}
        onRefreshMap={onRefreshMap}
      />
      <div className="space-y-1">
        <label className="text-sm text-muted-foreground">Status</label>
        <select
          className={FIELD_CLASS}
          value={form.status ?? 'UNKNOWN'}
          onChange={e => setForm(f => ({ ...f, status: e.target.value as RobotMode }))}
        >
          {ROBOT_MODES.map(mode => (
            <option key={mode} value={mode}>
              {mode}
            </option>
          ))}
        </select>
      </div>

      <ChannelEditor editor={channelEditor} />
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 focus-ring disabled:opacity-60"
      >
        <Save className="h-4 w-4" />
        {form.id ? 'Update Robot' : 'Create Robot'}
      </button>
    </div>
  );
}
