import { useQuery } from '@tanstack/react-query';
import { missionRunsQuery } from '../queries';

export function useMissionRuns(filters?: Parameters<typeof missionRunsQuery>[0]) {
  return useQuery({ ...missionRunsQuery(filters), refetchInterval: 5_000 });
}
