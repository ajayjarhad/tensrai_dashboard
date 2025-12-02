import type { ProcessedMapData } from '@tensrai/shared';
import { apiClient } from '@/lib/api';
import type { MissionWithContext } from '../components/MissionDialog';

export const getMissions = async (): Promise<MissionWithContext[]> => {
  const missions: MissionWithContext[] = [];

  // First get all maps
  const mapsRes = await apiClient.get<{ data: { id: string; name: string }[] }>('maps');
  const maps = mapsRes?.data ?? [];

  // Then get missions for each map
  for (const map of maps) {
    try {
      const mapDetail = await apiClient.get<{
        data?: { features?: ProcessedMapData['features'] };
      }>(`maps/${map.id}`);

      const features = mapDetail?.data?.features;
      if (features?.missions?.length) {
        const locationTags = features.locationTags ?? [];
        features.missions.forEach(mission => {
          const steps = Array.isArray((mission as any).steps)
            ? (mission as any).steps
            : Array.isArray((mission as any).locationTagId)
              ? (mission as any).locationTagId.map((id: any) => String(id))
              : [];
          missions.push({
            id: String(mission.id),
            name: mission.name,
            steps,
            mapId: map.id,
            mapName: map.name,
            locationTags,
            availableRobots: [],
          });
        });
      }
    } catch (err) {
      console.error('Failed to load missions for map', map.id, err);
      // Continue with other maps
    }
  }

  return missions;
};
