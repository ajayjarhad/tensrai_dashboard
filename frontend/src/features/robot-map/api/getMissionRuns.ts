import { apiClient } from '@/lib/api';

export type MissionRunRecord = {
  id: string;
  robotId: string;
  robotNameSnapshot: string;
  missionId?: string | null;
  missionNameSnapshot?: string | null;
  mapId?: string | null;
  runId?: string | null;
  status: string;
  phase: string;
  requestIdLast?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  durationMs?: number | null;
  waypointIndex?: number | null;
  totalWaypoints?: number | null;
  lastMessage?: string | null;
  lastEvent?: string | null;
  lastEventAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

interface MissionRunsResponse {
  success: boolean;
  data: MissionRunRecord[];
}

export const getMissionRuns = async (params?: {
  robotId?: string;
  status?: string;
  limit?: number;
}): Promise<MissionRunRecord[]> => {
  const searchParams = new URLSearchParams();
  if (params?.robotId) searchParams.set('robotId', params.robotId);
  if (params?.status) searchParams.set('status', params.status);
  if (typeof params?.limit === 'number') searchParams.set('limit', String(params.limit));
  const suffix = searchParams.toString();
  const result = await apiClient.get<MissionRunsResponse>(
    `mission-runs${suffix ? `?${suffix}` : ''}`
  );
  return result.data;
};
