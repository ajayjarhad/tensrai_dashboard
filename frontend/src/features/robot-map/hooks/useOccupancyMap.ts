import { useCallback, useEffect, useRef, useState } from 'react';
import {
  evictFromCache,
  loadMapAssets,
  type MapLoadProgress,
  type ProcessedMapDataWithBitmap,
} from '../../../lib/map/loadMapAssets';

export interface UseOccupancyMapState {
  data: ProcessedMapDataWithBitmap | null;
  loading: boolean;
  error: string | null;
  progress: MapLoadProgress | null;
  reload: () => void;
}

export function useOccupancyMap(mapId: string): UseOccupancyMapState {
  const [state, setState] = useState<{
    data: ProcessedMapDataWithBitmap | null;
    loading: boolean;
    error: string | null;
    progress: MapLoadProgress | null;
  }>({
    data: null,
    loading: false,
    error: null,
    progress: null,
  });

  const mountedRef = useRef(false);
  const requestIdRef = useRef(0);
  const loadMap = useCallback(async () => {
    if (!mountedRef.current) {
      return;
    }

    setState(prev => ({
      ...prev,
      loading: true,
      error: null,
      progress: { phase: 'fetching-metadata', progress: 0 },
    }));

    const requestId = ++requestIdRef.current;

    try {
      const data = await loadMapAssets({
        mapId,
        progressCallback: progress => {
          if (mountedRef.current && requestId === requestIdRef.current) {
            setState(prev => ({ ...prev, progress }));
          }
        },
      });

      // Only update if this is the latest request and component is still mounted
      if (mountedRef.current && requestId === requestIdRef.current) {
        setState({
          data,
          loading: false,
          error: null,
          progress: { phase: 'ready', progress: 100 },
        });
      }
    } catch (error) {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setState(prev => ({
          ...prev,
          loading: false,
          error: error instanceof Error ? error.message : 'Failed to load map',
          progress: {
            phase: 'failed',
            message: error instanceof Error ? error.message : 'Failed to load map',
          },
        }));
      }
    }
  }, [mapId]);

  const reload = useCallback(() => {
    evictFromCache(mapId);
    loadMap();
  }, [mapId, loadMap]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (mapId) loadMap();
  }, [mapId, loadMap]);

  return {
    data: state.data,
    loading: state.loading,
    error: state.error,
    progress: state.progress,
    reload,
  };
}
