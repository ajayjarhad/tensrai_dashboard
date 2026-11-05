import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LogIn, Plus, ShieldCheck, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { TemporaryPassword } from '@/features/admin/components/TemporaryPassword';
import { queryKeys } from '@/lib/query-keys';
import {
  addOrgAdmin,
  approveAddressAhead,
  createOrg,
  enterOrg,
  getOrgs,
  type NewAdmin,
  type StaffOrg,
} from '../api';

const INPUT =
  'px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground focus-ring';
const ROW_ACTION =
  'inline-flex items-center gap-1 text-sm text-primary hover:text-primary/80 focus-ring';

type OrgForm = { name: string; slug: string; username: string; email: string };
const EMPTY_FORM: OrgForm = { name: '', slug: '', username: '', email: '' };

const askFor = (label: string) => window.prompt(label)?.trim() || null;

export function OrgTable() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<OrgForm>(EMPTY_FORM);
  const [newAdmin, setNewAdmin] = useState<NewAdmin | null>(null);
  const { data: orgs = [], isLoading } = useQuery({
    queryKey: queryKeys.staff.orgs,
    queryFn: getOrgs,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.staff.orgs });
    queryClient.invalidateQueries({ queryKey: queryKeys.staff.addresses });
  };
  const showError = (error: Error) => toast.error(error.message);

  const create = useMutation({
    mutationFn: createOrg,
    onSuccess: admin => {
      setNewAdmin(admin);
      setForm(EMPTY_FORM);
      refresh();
    },
    onError: showError,
  });

  const addAdmin = useMutation({
    mutationFn: ({ orgId, username, email }: { orgId: string; username: string; email: string }) =>
      addOrgAdmin(orgId, { username, email }),
    onSuccess: admin => {
      setNewAdmin(admin);
      refresh();
    },
    onError: showError,
  });

  const approveAhead = useMutation({
    mutationFn: ({ orgId, ip }: { orgId: string; ip: string }) => approveAddressAhead(orgId, ip),
    onSuccess: () => {
      toast.success('Address approved');
      refresh();
    },
    onError: showError,
  });

  const open = useMutation({
    mutationFn: enterOrg,
    // A full reload resets every socket, store and cache belonging to the previous organization.
    onSuccess: () => window.location.assign('/'),
    onError: showError,
  });

  const promptAddAdmin = (org: StaffOrg) => {
    const username = askFor(`Username for the new ${org.name} admin`);
    const email = username && askFor('Their email');
    if (username && email) addAdmin.mutate({ orgId: org.id, username, email });
  };

  const promptApproveAhead = (org: StaffOrg) => {
    const ip = askFor(`Robot address to approve for ${org.name}`);
    if (ip) approveAhead.mutate({ orgId: org.id, ip });
  };

  const field = (key: keyof OrgForm, placeholder: string, type = 'text') => (
    <input
      required
      type={type}
      aria-label={placeholder}
      placeholder={placeholder}
      value={form[key]}
      onChange={event => setForm(current => ({ ...current, [key]: event.target.value }))}
      className={INPUT}
    />
  );

  return (
    <section className="space-y-2">
      <h2 className="text-xl font-semibold text-foreground">Organizations</h2>

      {newAdmin && (
        <TemporaryPassword
          username={newAdmin.user.username}
          email={newAdmin.user.email}
          password={newAdmin.tempPassword}
          onDismiss={() => setNewAdmin(null)}
        />
      )}

      <form
        className="bg-card shadow sm:rounded-md p-4 flex gap-2 flex-wrap items-center"
        onSubmit={event => {
          event.preventDefault();
          create.mutate(form);
        }}
      >
        {field('name', 'Organization name')}
        {field('slug', 'slug (lowercase-with-dashes)')}
        {field('username', 'First admin username')}
        {field('email', 'First admin email', 'email')}
        <button
          type="submit"
          disabled={create.isPending}
          className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-md text-sm font-medium focus-ring inline-flex items-center gap-2 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Create organization
        </button>
      </form>

      <div className="bg-card shadow overflow-x-auto sm:rounded-md">
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading…</div>
        ) : (
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-secondary">
              <tr>
                {['Name', 'Users', 'Robots', 'Waiting addresses', 'Actions'].map(heading => (
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
              {orgs.map(org => (
                <tr key={org.id}>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="text-sm font-medium text-foreground">{org.name}</div>
                    <div className="text-xs text-muted-foreground">{org.slug}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-foreground">{org.users}</td>
                  <td className="px-4 py-3 text-sm text-foreground">{org.robots}</td>
                  <td className="px-4 py-3 text-sm text-foreground">{org.pendingAddresses}</td>
                  <td className="px-4 py-3 whitespace-nowrap space-x-3">
                    <button
                      type="button"
                      onClick={() => open.mutate(org.id)}
                      className={ROW_ACTION}
                    >
                      <LogIn className="h-4 w-4" />
                      Open
                    </button>
                    <button
                      type="button"
                      onClick={() => promptAddAdmin(org)}
                      className={ROW_ACTION}
                    >
                      <UserPlus className="h-4 w-4" />
                      Add admin
                    </button>
                    <button
                      type="button"
                      onClick={() => promptApproveAhead(org)}
                      className={ROW_ACTION}
                    >
                      <ShieldCheck className="h-4 w-4" />
                      Approve address
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
