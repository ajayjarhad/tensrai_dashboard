import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { getRobots } from '../api';

export function useRobots(enabled = true) {
  return useQuery({
    queryKey: queryKeys.robots.lists,
    queryFn: getRobots,
    enabled,
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
}
