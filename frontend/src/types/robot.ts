import type { RobotEmergencyConnectionStatus } from '@tensrai/shared';

export enum RobotMode {
  MISSION = 'MISSION',
  DOCKING = 'DOCKING',
  CHARGING = 'CHARGING',
  SW_EMERGENCY = 'SW_EMERGENCY',
  HW_EMERGENCY = 'HW_EMERGENCY',
  TELEOP = 'TELEOP',
  HRI = 'HRI',
  UNKNOWN = 'UNKNOWN',
}

export interface Robot {
  id: string;
  name: string;
  status: RobotMode;
  battery?: number;
  mapId?: string;
  bridgePort?: number;
  mappingBridgePort?: number;
  missionBridgePort?: number;
  emergencyBridgePort?: number;
  channels?: Array<{
    name: string;
    topic: string;
    msgType: string;
    direction: 'subscribe' | 'publish';
    rateLimitHz?: number;
    connectionId?: string;
  }>;
  x?: number;
  y?: number;
  theta?: number;
  ipAddress?: string;
  lastSeen: string; // ISO Date string
  createdAt: string;
  updatedAt: string;
  runtimeMode?: 'teleop' | 'autonomous';
  runtimeBatteryPercentage?: number | null;
  runtimeChargingStatus?: string | null;
  runtimeLastSeenTs?: number;
  emergency?: {
    softwareEmergencyActive: boolean;
    hardwareEmergencyActive: boolean;
    effectiveEmergencyActive: boolean;
    connectionStatus: RobotEmergencyConnectionStatus;
    updatedAt?: number;
    lastObservedAt?: number;
    lastEventType?: 'EMERGENCY_STATE' | 'SOFTWARE_EMERGENCY_ACK' | 'HARDWARE_EMERGENCY_ACK';
    lastEventAt?: number;
  };
  waypointIndex?: number;
  totalWaypoints?: number;
  mission?: {
    status?: string;
    currentMissionId?: string;
    message?: string;
    lastEvent?: string;
    updatedAt?: string;
    lastEventStatus?: string;
    lastRequestType?: string;
    mode?: 'teleop' | 'autonomous';
    batteryPercentage?: number | null;
    chargingStatus?: string | null;
    lastSeenTs?: number;
    waypointIndex?: number;
    totalWaypoints?: number;
  };
}
