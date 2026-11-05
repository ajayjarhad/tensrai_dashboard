import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { queryKeys } from '@/lib/query-keys';
import { getOrgs, moveRobot } from '../api';

interface MoveRobotControlProps {
  robotId: string;
  robotName: string;
  currentOrgId: string | undefined;
  onMoved: () => Promise<unknown>;
}

export function MoveRobotControl({
  robotId,
  robotName,
  currentOrgId,
  onMoved,
}: MoveRobotControlProps) {
  const { data: orgs = [] } = useQuery({ queryKey: queryKeys.staff.orgs, queryFn: getOrgs });

  const move = async (orgId: string) => {
    const org = orgs.find(candidate => candidate.id === orgId);
    if (!org || !confirm(`Move ${robotName} with its maps and history to ${org.name}?`)) return;
    try {
      await moveRobot(robotId, orgId);
      await onMoved();
      toast.success(`Moved to ${org.name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not move the robot');
    }
  };

  return (
    <select
      aria-label={`Move ${robotName} to another organization`}
      value=""
      onChange={event => move(event.target.value)}
      className="bg-background border border-input rounded-md text-xs text-foreground px-1 py-1 focus-ring"
    >
      <option value="" disabled>
        Move to…
      </option>
      {orgs
        .filter(org => org.id !== currentOrgId)
        .map(org => (
          <option key={org.id} value={org.id}>
            {org.name}
          </option>
        ))}
    </select>
  );
}
