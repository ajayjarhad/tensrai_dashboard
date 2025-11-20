/**
 * Hook for Loading and Managing Occupancy Map Data
 * Handles map asset loading, caching, and error states
 */

import type { ProcessedMapData } from '@tensrai/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { clearMapAssetCache, evictFromCache, loadMapAssets } from '../../../lib/map';

export interface UseOccupancyMapState {
  data: ProcessedMapData | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export interface UseOccupancyMapOptions {
  mapYamlPath: string;
  basePath?: string;
  cacheEnabled?: boolean;
  autoLoad?: boolean;
  // PGM optimization options
  useOptimizedParser?: boolean;
  pgmQuality?: number; // 1-100, lower values reduce resolution
  chunkSize?: number; // Chunk size for processing large files
  progressCallback?: (progress: number) => void; // Progress reporting
}

/**
 * Hook to load and manage occupancy map data
 * @param options Loading options including YAML path
 * @returns Map data state and controls
 */
export function useOccupancyMap(options: UseOccupancyMapOptions): UseOccupancyMapState {
  const {
    mapYamlPath,
    basePath = '',
    cacheEnabled = true,
    autoLoad = true,
    useOptimizedParser,
    pgmQuality,
    chunkSize,
    progressCallback,
  } = options;

  const [state, setState] = useState<{
    data: ProcessedMapData | null;
    loading: boolean;
    error: string | null;
  }>({
    data: null,
    loading: false,
    error: null,
  });

  const mountedRef = useRef(false);
  const requestIdRef = useRef(0);
  const loadMap = useCallback(async () => {
    if (!mountedRef.current) {
      return;
    }

    setState(prev => ({ ...prev, loading: true, error: null }));

    const requestId = ++requestIdRef.current;

    try {
      const loadOptions: any = {
        yamlPath: mapYamlPath,
        basePath,
        cacheEnabled,
        useOptimizedParser,
        pgmQuality,
      };

      if (chunkSize !== undefined) {
        loadOptions.chunkSize = chunkSize;
      }

      if (progressCallback !== undefined) {
        loadOptions.progressCallback = progressCallback;
      }

      const data = await loadMapAssets(loadOptions);

      // Only update if this is the latest request and component is still mounted
      if (mountedRef.current && requestId === requestIdRef.current) {
        setState({
          data,
          loading: false,
          error: null,
        });
      }
    } catch (error) {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setState(prev => ({
          ...prev,
          loading: false,
          error: error instanceof Error ? error.message : 'Failed to load map',
        }));
      }
    }
  }, [
    mapYamlPath,
    basePath,
    cacheEnabled,
    useOptimizedParser,
    pgmQuality,
    chunkSize,
    progressCallback,
  ]);

  const reload = useCallback(() => {
    evictFromCache(mapYamlPath, basePath);
    loadMap();
  }, [mapYamlPath, basePath, loadMap]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, []);

  // Auto-load on mount
  useEffect(() => {
    if (!autoLoad || !mapYamlPath) {
      return;
    }

    loadMap();
  }, [autoLoad, mapYamlPath, loadMap]);

  return {
    data: state.data,
    loading: state.loading,
    error: state.error,
    reload,
  };
}

/**
 * Hook to manage global map cache
 */
export function useMapCache() {
  const clearCache = useCallback(() => {
    clearMapAssetCache();
  }, []);

  return {
    clearCache,
  };
}
