import { AddressRequests } from './AddressRequests';
import { OrgTable } from './OrgTable';

export function OrganizationsPage() {
  return (
    <div className="min-h-full bg-background">
      <div className="container mx-auto px-4 py-10 space-y-8">
        <h1 className="text-3xl font-bold text-foreground">Organizations</h1>
        <AddressRequests />
        <OrgTable />
      </div>
    </div>
  );
}
