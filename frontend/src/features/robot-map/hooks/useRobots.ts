import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { getRobots } from '../api';

export function useRobots(enabled = true) {
  return useQuery({
    queryKey: queryKeys.robots.lists,
    queryFn: getRobots,
    enabled,
    // Avoid hammering the endpoint; rely on focus revalidation/manual refetch
    refetchInterval: false,
    staleTime: 5_000,
  });
}
