import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Unplug, X } from 'lucide-react';
import { toast } from 'sonner';
import { queryKeys } from '@/lib/query-keys';
import {
  type AddressStatus,
  approveAddress,
  getAddresses,
  rejectAddress,
  releaseAddress,
  type StaffAddress,
} from '../api';

const STATUS_LABEL: Record<AddressStatus, string> = {
  PENDING: 'Waiting',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

const ACTION_BUTTON = 'inline-flex items-center gap-1 text-sm focus-ring disabled:opacity-50';

function AddressRow({
  address,
  onAction,
  busy,
}: {
  address: StaffAddress;
  onAction: (action: (id: string) => Promise<unknown>, id: string) => void;
  busy: boolean;
}) {
  const heldElsewhere = address.otherOrgs.find(other => other.status === 'APPROVED');

  return (
    <tr>
      <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-foreground">
        {address.ip}
      </td>
      <td className="px-4 py-3 text-sm text-foreground">
        {address.orgName ?? 'Unknown'}
        {address.requestedBy && (
          <div className="text-xs text-muted-foreground">Requested by {address.requestedBy}</div>
        )}
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {address.robots.length ? address.robots.join(', ') : '—'}
      </td>
      <td className="px-4 py-3 text-sm">
        <span className="text-foreground">{STATUS_LABEL[address.status]}</span>
        {address.otherOrgs.length > 0 && (
          <div
            className={`text-xs ${heldElsewhere ? 'text-destructive' : 'text-muted-foreground'}`}
          >
            Also requested by{' '}
            {address.otherOrgs
              .map(other => `${other.name ?? 'unknown'} (${STATUS_LABEL[other.status]})`)
              .join(', ')}
          </div>
        )}
      </td>
      <td className="px-4 py-3 whitespace-nowrap space-x-3">
        {address.status !== 'APPROVED' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onAction(approveAddress, address.id)}
            className={`${ACTION_BUTTON} text-primary hover:text-primary/80`}
          >
            <Check className="h-4 w-4" />
            Approve
          </button>
        )}
        {address.status !== 'REJECTED' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onAction(rejectAddress, address.id)}
            className={`${ACTION_BUTTON} text-destructive hover:text-destructive/80`}
          >
            <X className="h-4 w-4" />
            Reject
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (confirm(`Release ${address.ip}? Its robots lose this address.`)) {
              onAction(releaseAddress, address.id);
            }
          }}
          className={`${ACTION_BUTTON} text-muted-foreground hover:text-foreground`}
        >
          <Unplug className="h-4 w-4" />
          Release
        </button>
      </td>
    </tr>
  );
}

export function AddressRequests() {
  const queryClient = useQueryClient();
  const { data: addresses = [], isLoading } = useQuery({
    queryKey: queryKeys.staff.addresses,
    queryFn: getAddresses,
    refetchInterval: 15_000,
  });

  const decide = useMutation({
    mutationFn: ({ action, id }: { action: (id: string) => Promise<unknown>; id: string }) =>
      action(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.staff.addresses });
      queryClient.invalidateQueries({ queryKey: queryKeys.staff.orgs });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const pending = addresses.filter(address => address.status === 'PENDING').length;

  return (
    <section className="space-y-2">
      <h2 className="text-xl font-semibold text-foreground">
        Robot addresses
        {pending > 0 && (
          <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-primary text-primary-foreground">
            {pending} waiting
          </span>
        )}
      </h2>
      <p className="text-sm text-muted-foreground">
        The dashboard won&apos;t connect to a robot until its address is approved for that
        organization. Check the address really belongs to them.
      </p>
      <div className="bg-card shadow overflow-x-auto sm:rounded-md">
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading…</div>
        ) : addresses.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No robot addresses yet</div>
        ) : (
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-secondary">
              <tr>
                {['Address', 'Organization', 'Robots', 'Status', 'Actions'].map(heading => (
                  <th
                    key={heading}
                    className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-background divide-y divide-border">
              {addresses.map(address => (
                <AddressRow
                  key={address.id}
                  address={address}
                  busy={decide.isPending}
                  onAction={(action, id) => decide.mutate({ action, id })}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
