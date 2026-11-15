import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Power, PowerOff } from 'lucide-react';
import { toast } from 'sonner';
import { queryKeys } from '@/lib/query-keys';
import { deactivateOrg, reactivateOrg, type StaffOrg } from '../api';

const ACTION = 'inline-flex items-center gap-1 text-sm focus-ring disabled:opacity-50';

// Deactivating deletes nothing: it signs the organization's people out and keeps its robots
// disconnected until staff reactivate it. Staff's own organization has no switch.
export function OrgActivation({ org }: { org: StaffOrg }) {
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: () => (org.deactivatedAt ? reactivateOrg(org.id) : deactivateOrg(org.id)),
    onSuccess: () => {
      toast.success(org.deactivatedAt ? `${org.name} reactivated` : `${org.name} deactivated`);
      queryClient.invalidateQueries({ queryKey: queryKeys.staff.orgs });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (org.holdsStaff) return null;

  if (org.deactivatedAt) {
    return (
      <button
        type="button"
        disabled={toggle.isPending}
        onClick={() => toggle.mutate()}
        className={`${ACTION} text-primary hover:text-primary/80`}
      >
        <Power className="h-4 w-4" />
        Reactivate
      </button>
    );
  }

  const confirmDeactivate = () => {
    const message = `Deactivate ${org.name}? Its people are signed out and can't sign in, and its robots disconnect, until you reactivate it. Nothing is deleted.`;
    if (window.confirm(message)) toggle.mutate();
  };

  return (
    <button
      type="button"
      disabled={toggle.isPending}
      onClick={confirmDeactivate}
      className={`${ACTION} text-destructive hover:text-destructive/80`}
    >
      <PowerOff className="h-4 w-4" />
      Deactivate
    </button>
  );
}
