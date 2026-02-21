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
