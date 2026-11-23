import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { queryKeys } from '@/lib/query-keys';
import { mapsApi } from './api';
import { anySyncing } from './mapList';

export const mapsListQuery = queryOptions({
  queryKey: queryKeys.maps.lists,
  queryFn: mapsApi.list,
});

// What a map change can affect: the maps, each robot's map list, and the missions those maps carry.
export function useRefreshMaps() {
  const queryClient = useQueryClient();
  return useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.maps.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.robots.lists, refetchType: 'all' }),
        queryClient.invalidateQueries({ queryKey: queryKeys.missions.all }),
      ]),
    [queryClient]
  );
}

// Polls every 2 s while a robot is syncing, every 30 s otherwise; when the last sync finishes, the
// robots and missions that depend on its maps are refreshed too.
export function useMaps() {
  const query = useQuery({
    ...mapsListQuery,
    // Fast while a robot syncs; otherwise often enough to show imports and other people's changes.
    refetchInterval: current => (anySyncing(current.state.data) ? 2_000 : 30_000),
  });
  const refreshMaps = useRefreshMaps();
  const syncing = anySyncing(query.data);
  const wasSyncing = useRef(syncing);
  useEffect(() => {
    if (wasSyncing.current && !syncing) void refreshMaps();
    wasSyncing.current = syncing;
  }, [syncing, refreshMaps]);
  return query;
}
