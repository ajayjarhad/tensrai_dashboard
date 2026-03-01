import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { getMissionRuns } from '../api/getMissionRuns';

export function useMissionRuns(params?: { robotId?: string; status?: string; limit?: number }) {
  const key = JSON.stringify(params ?? {});
  return useQuery({
    queryKey: queryKeys.missions.runs(key),
    queryFn: () => getMissionRuns(params),
    staleTime: 2_000,
    refetchInterval: 5_000,
  });
}
