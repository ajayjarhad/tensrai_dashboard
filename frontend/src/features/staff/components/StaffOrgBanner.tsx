import { ROLE } from '@tensrai/shared';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/auth';
import { exitOrg } from '../api';

// Hard to miss on purpose: everything a staff member does here happens in a customer's organization.
export function StaffOrgBanner() {
  const user = useAuthStore(state => state.user);
  if (user?.role !== ROLE.STAFF || !user.homeOrgId || user.orgId === user.homeOrgId) return null;

  const leave = async () => {
    try {
      await exitOrg();
      // A full reload resets every socket, store and cache belonging to this organization.
      window.location.assign('/staff');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not leave the organization');
    }
  };

  return (
    <output className="bg-primary text-primary-foreground px-4 py-2 text-sm flex items-center justify-center gap-3">
      <span>
        Viewing <strong>{user.orgName ?? 'another organization'}</strong> as Tensrai staff
      </span>
      <button
        type="button"
        onClick={leave}
        className="underline underline-offset-2 hover:opacity-80 focus-ring"
      >
        Exit
      </button>
    </output>
  );
}
