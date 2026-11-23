import { apiClient } from '@/lib/api';

// Every map a robot is behind on, in one job; null when it is up to date. Its own module, so the
// Robots page can offer "Sync maps" without loading the rest of the maps API.
export const syncRobotMaps = async (robotId: string) =>
  (
    await apiClient.post<{ data: { mapIds: string[] } | null }>(
      `robots/${robotId}/maps/push`,
      {},
      { retry: 0 }
    )
  ).data;
