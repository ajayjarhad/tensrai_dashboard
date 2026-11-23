import { Outlet } from '@tanstack/react-router';
import { useFleetEmergency } from '@/features/emergency-stop/useFleetEmergency';
import { EmergencyAlertDialog } from '@/features/robot-map/components/EmergencyAlertDialog';
import { StaffOrgBanner } from '@/features/staff/components/StaffOrgBanner';
import { AppHeader } from './AppHeader';

export { pages } from './pages';

// Every signed-in page sits in here, so the header, the fleet E-stop and its alerts are always up.
export function AppShell() {
  const { fleet, controls, emergencyAlerts, acknowledgeEmergencyAlerts } = useFleetEmergency();

  return (
    <div className="flex h-full flex-col">
      <StaffOrgBanner />
      <AppHeader fleet={fleet} controls={controls} />
      <main className="min-h-0 flex-1 overflow-auto">
        <Outlet />
      </main>
      <EmergencyAlertDialog alerts={emergencyAlerts} onAcknowledge={acknowledgeEmergencyAlerts} />
    </div>
  );
}
