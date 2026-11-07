import type { ProcessedMapData } from '@tensrai/shared';
import type { Robot } from '@/types/robot';

export type MissionWithContext = {
  id: string;
  name: string;
  steps: string[];
  mapId: string;
  mapName: string;
  locationTags: NonNullable<ProcessedMapData['features']>['locationTags'];
  availableRobots: Robot[];
};

export type ResolveMissionContext = (
  missionId?: string,
  mapId?: string
) => MissionWithContext | null;

export type EmergencyAlert = {
  id: string;
  robotId: string;
  robotName: string;
  kind: 'software' | 'hardware';
};

export type FocusedMission = {
  robotId: string;
  missionId?: string;
  mapId: string;
};

export type PendingMissionStart = {
  robotId: string;
  mission: MissionWithContext;
};
