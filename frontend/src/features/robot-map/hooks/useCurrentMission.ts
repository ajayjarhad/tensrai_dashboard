import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { getCurrentMission } from '../api/getCurrentMission';

export function useCurrentMission(robotId: string | null | undefined) {
  return useQuery({
    queryKey: robotId
      ? queryKeys.missions.current(robotId)
      : ['robot-map', 'missions', 'current', 'none'],
    queryFn: () => getCurrentMission(robotId as string),
    enabled: Boolean(robotId),
    staleTime: 2_000,
    refetchInterval: 5_000,
  });
}
