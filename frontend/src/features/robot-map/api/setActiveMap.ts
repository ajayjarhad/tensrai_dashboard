import { apiClient } from '@/lib/api';
import type { RobotMapAssignment } from '@/types/robot';

interface ActiveMapResponse {
  success: boolean;
  data: RobotMapAssignment[];
}

export const setActiveMap = async (
  robotId: string,
  mapId: string
): Promise<RobotMapAssignment[]> => {
  const result = await apiClient.post<ActiveMapResponse>(`robots/${robotId}/active-map`, { mapId });
  return result.data;
};

export const clearActiveMapPin = async (robotId: string): Promise<RobotMapAssignment[]> => {
  const result = await apiClient.post<ActiveMapResponse>(`robots/${robotId}/active-map/auto`);
  return result.data;
};
