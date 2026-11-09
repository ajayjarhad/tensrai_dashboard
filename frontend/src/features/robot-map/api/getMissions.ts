import type { ProcessedMapData } from '@tensrai/shared';
import { apiClient } from '@/lib/api';
import { fetchMapMetadata } from '@/lib/map/loadMapAssets';
import type { MissionWithContext } from '../types';

type MapFeatures = ProcessedMapData['features'];

const missionsOfMap = (
  map: { id: string; name: string },
  features: MapFeatures | undefined
): MissionWithContext[] => {
  if (!features?.missions?.length) return [];
  const locationTags = features.locationTags ?? [];
  return features.missions.map(mission => {
    // Maps stored before steps existed list a mission's tags as locationTagId.
    const stored: { steps?: unknown; locationTagId?: unknown } = mission;
    const steps = Array.isArray(stored.steps)
      ? mission.steps
      : Array.isArray(stored.locationTagId)
        ? stored.locationTagId.map((id: unknown) => String(id))
        : [];
    return {
      id: String(mission.id),
      name: mission.name,
      steps,
      mapId: map.id,
      mapName: map.name,
      locationTags,
      availableRobots: [],
    };
  });
};

export const getMissions = async (): Promise<MissionWithContext[]> => {
  const mapsRes = await apiClient.get<{ data: { id: string; name: string }[] }>('maps');
  const maps = mapsRes?.data ?? [];

  // Fetched together rather than one after another; a map that fails is skipped.
  const perMap = await Promise.all(
    maps.map(async map => {
      try {
        const mapDetail = await fetchMapMetadata(map.id);
        return missionsOfMap(map, mapDetail?.data?.features);
      } catch (err) {
        console.error('Failed to load missions for map', map.id, err);
        return [];
      }
    })
  );
  return perMap.flat();
};
