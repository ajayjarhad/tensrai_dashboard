import { Save, Trash2 } from 'lucide-react';
import { MoveRobotControl } from '@/features/staff/components/MoveRobotControl';
import { getRobotDisplayStatusLabel } from '@/lib/robotStatus';
import type { Robot } from '@/types/robot';
import type { MapOption } from '../robotFormModel';

const COLUMNS = ['Name', 'IP / Port', 'Map', 'Status', 'Actions'];

type RobotTableProps = {
  robots: Robot[];
  loading: boolean;
  maps: MapOption[];
  addressStatusByIp: Record<string, string>;
  canMoveRobots: boolean;
  currentOrgId: string | undefined;
  onEdit: (robot: Robot) => void;
  onDelete: (robotId: string) => void;
  onMoved: () => Promise<unknown>;
};

type RobotRowProps = Omit<RobotTableProps, 'robots' | 'loading'> & { robot: Robot };

function RobotRow({
  robot,
  maps,
  addressStatusByIp,
  canMoveRobots,
  currentOrgId,
  onEdit,
  onDelete,
  onMoved,
}: RobotRowProps) {
  const addressStatus = robot.ipAddress ? addressStatusByIp[robot.ipAddress] : undefined;
  const extraMapCount = (robot.maps?.length ?? 0) - 1;

  return (
    <tr>
      <td className="px-4 py-3 whitespace-nowrap">
        <div className="text-sm font-medium text-foreground">{robot.name}</div>
        <div className="text-xs text-muted-foreground">{robot.id}</div>
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-sm text-foreground">
        {robot.ipAddress ?? '—'}:{robot.bridgePort ?? 9090}
        {robot.mappingBridgePort ? ` / ${robot.mappingBridgePort}` : ''}
        {robot.missionBridgePort ? ` / ${robot.missionBridgePort}` : ''}
        {robot.emergencyBridgePort ? ` / ${robot.emergencyBridgePort}` : ''}
        {addressStatus === 'PENDING' && (
          <div className="text-xs text-muted-foreground">
            Waiting for approval. The dashboard won&apos;t connect until then.
          </div>
        )}
        {addressStatus === 'REJECTED' && (
          <div className="text-xs text-destructive">
            Address rejected. The dashboard won&apos;t connect to it.
          </div>
        )}
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-sm text-foreground">
        {robot.maps?.find(m => m.isActive)?.name ??
          maps.find(m => m.id === robot.mapId)?.name ??
          '—'}
        {extraMapCount > 0 ? (
          <span className="ml-1 text-xs text-muted-foreground">(+{extraMapCount})</span>
        ) : null}
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-sm text-muted-foreground">
        {getRobotDisplayStatusLabel(robot)}
      </td>
      <td className="px-4 py-3 text-sm font-medium">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <button
            type="button"
            onClick={() => onEdit(robot)}
            className="text-primary hover:text-primary/80 focus-ring inline-flex items-center gap-1"
          >
            <Save className="h-4 w-4 rotate-90" />
            Edit
          </button>
          <button
            type="button"
            onClick={() => onDelete(robot.id)}
            className="text-destructive hover:text-destructive/80 focus-ring inline-flex items-center gap-1"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
          {canMoveRobots && (
            <MoveRobotControl
              robotId={robot.id}
              robotName={robot.name}
              currentOrgId={currentOrgId}
              onMoved={onMoved}
            />
          )}
        </div>
      </td>
    </tr>
  );
}

export function RobotTable({ robots, loading, ...rowProps }: RobotTableProps) {
  return (
    <div className="bg-card shadow overflow-x-auto sm:rounded-md">
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
              {COLUMNS.map(column => (
                <th
                  key={column}
                  className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-background divide-y divide-border">
            {robots.map(robot => (
              <RobotRow key={robot.id} robot={robot} {...rowProps} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
