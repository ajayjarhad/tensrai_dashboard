type FleetEmergencySummary = {
  totalRobots: number;
  connectedRobots: number;
  softwareEmergencyCount: number;
  hardwareEmergencyCount: number;
  unknownCount: number;
  anyEmergencyActive: boolean;
};

export interface EmergencyHeaderProps {
  className?: string;
  summary: FleetEmergencySummary;
  pendingDesiredStatus?: boolean | null;
  canSendEmergency?: boolean;
  canReleaseSoftware?: boolean;
  onEmergencyAll?: () => void;
  onReleaseSoftware?: () => void;
}

export type { FleetEmergencySummary };
