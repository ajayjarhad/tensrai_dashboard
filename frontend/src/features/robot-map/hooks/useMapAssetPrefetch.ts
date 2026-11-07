import { useEffect, useRef } from 'react';
import { loadMapAssets } from '@/lib/map/loadMapAssets';
import type { Robot } from '@/types/robot';

export const useMapAssetPrefetch = (robots: Robot[]) => {
  const prefetchedMapIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const mapIds = Array.from(
      new Set(robots.map(robot => robot.mapId).filter((mapId): mapId is string => Boolean(mapId)))
    ).filter(mapId => !prefetchedMapIdsRef.current.has(mapId));

    if (mapIds.length === 0) return;

    let cancelled = false;
    void (async () => {
      for (const mapId of mapIds) {
        if (cancelled) return;
        prefetchedMapIdsRef.current.add(mapId);
        try {
          await loadMapAssets({ mapId, cacheEnabled: true, timeout: 60_000 });
        } catch {
          prefetchedMapIdsRef.current.delete(mapId);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [robots]);
};
