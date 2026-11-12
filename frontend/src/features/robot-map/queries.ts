import { type QueryClient, queryOptions } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { getMissionRuns } from './api/getMissionRuns';
import { getMissions } from './api/getMissions';
import { getRobots } from './api/getRobots';

type RunFilters = { robotId?: string; status?: string; limit?: number };

export const RECENT_RUNS: RunFilters = { limit: 100 };

export const robotsQuery = queryOptions({
  queryKey: queryKeys.robots.lists,
  queryFn: getRobots,
  staleTime: 5_000,
});

export const missionRunsQuery = (filters?: RunFilters) =>
  queryOptions({
    queryKey: queryKeys.missions.runs(JSON.stringify(filters ?? {})),
    queryFn: () => getMissionRuns(filters),
    staleTime: 2_000,
  });

export const missionsQuery = queryOptions({
  queryKey: queryKeys.missions.lists,
  queryFn: getMissions,
  staleTime: 30_000,
});

// Started by the route while the dashboard's code is still downloading, instead of after it.
export const prefetchDashboard = (client: QueryClient) =>
  Promise.all([
    client.prefetchQuery(robotsQuery),
    client.prefetchQuery(missionRunsQuery(RECENT_RUNS)),
    client.prefetchQuery(missionsQuery),
  ]);
