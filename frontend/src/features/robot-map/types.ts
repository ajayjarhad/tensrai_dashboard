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
