import { useQuery } from '@tanstack/react-query';
import { robotsQuery } from '../queries';

export function useRobots(enabled = true) {
  return useQuery({ ...robotsQuery, enabled, refetchInterval: 10_000 });
}
