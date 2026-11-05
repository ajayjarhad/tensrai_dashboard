import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { AddressRequests } from './AddressRequests';
import { OrgTable } from './OrgTable';

export function OrganizationsPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-10 space-y-8">
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => navigate({ to: '/' })}
            className="px-3 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium focus-ring inline-flex items-center gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </button>
          <h1 className="text-3xl font-bold text-foreground">Organizations</h1>
        </div>
        <AddressRequests />
        <OrgTable />
      </div>
    </div>
  );
}
