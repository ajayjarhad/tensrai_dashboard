import { apiClient } from '@/lib/api';
import type { MissionRunRecord } from './getMissionRuns';

interface CurrentMissionResponse {
  success: boolean;
  data: MissionRunRecord | null;
}

export const getCurrentMission = async (robotId: string): Promise<MissionRunRecord | null> => {
  const result = await apiClient.get<CurrentMissionResponse>(`robots/${robotId}/current-mission`);
  return result.data;
};
