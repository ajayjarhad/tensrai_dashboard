import type { MapYamlMetadata, ProcessedMapData } from '@tensrai/shared';
import { api, apiClient } from '../api';
import type { MapWorkerRequest, MapWorkerResponse } from './map.worker';
import MapWorker from './map.worker?worker';

export interface ProcessedMapDataWithBitmap extends ProcessedMapData {
  imageBitmap?: ImageBitmap;
}

export interface LoadMapAssetsOptions {
  mapId: string;
  cacheEnabled?: boolean;
  timeout?: number;
  useOptimizedParser?: boolean;
  pgmQuality?: number;
  chunkSize?: number;
  progressCallback?: (progress: number) => void;
  retryFailedOperations?: boolean;
  maxRetries?: number;
}

const CACHE_CONFIG = {
  MAX_SIZE: 10,
  DEFAULT_TIMEOUT: 30000,
};

const mapCache = new Map<string, { promise: Promise<ProcessedMapDataWithBitmap>; at: number }>();
const cacheAccessOrder = new Map<string, number>();
let accessCounter = 0;

let mapWorker: Worker | null = null;

const cacheKeyForMap = (mapId: string) => `map_${mapId}`;

const getWorker = () => {
  if (!mapWorker) {
    mapWorker = new MapWorker();
  }
  return mapWorker;
};

const getFromCache = (key: string): Promise<ProcessedMapDataWithBitmap> | undefined => {
  const entry = mapCache.get(key);
  if (!entry) return undefined;
  accessCounter += 1;
  cacheAccessOrder.set(key, accessCounter);
  return entry.promise;
};

const removeFromCache = (key: string) => {
  mapCache.delete(key);
  cacheAccessOrder.delete(key);
};

const evictLeastRecentlyUsed = () => {
  let lruKey: string | undefined;
  let oldest = Number.POSITIVE_INFINITY;
  for (const [key, order] of cacheAccessOrder.entries()) {
    if (order < oldest) {
      oldest = order;
      lruKey = key;
    }
  }
  if (lruKey) {
    removeFromCache(lruKey);
  }
};

const addToCache = (key: string, promise: Promise<ProcessedMapDataWithBitmap>) => {
  if (mapCache.size >= CACHE_CONFIG.MAX_SIZE) {
    evictLeastRecentlyUsed();
  }
  mapCache.set(key, { promise, at: Date.now() });
  accessCounter += 1;
  cacheAccessOrder.set(key, accessCounter);
};

const processMapInWorker = async (
  pgmBuffer: ArrayBuffer,
  metadata: MapYamlMetadata,
  options: LoadMapAssetsOptions
) => {
  const worker = getWorker();
  return await new Promise<MapWorkerResponse>((resolve, reject) => {
    const handleMessage = (e: MessageEvent<MapWorkerResponse>) => {
      if (e.data.type !== 'MAP_PROCESSED') return;
      worker.removeEventListener('message', handleMessage);
      if (e.data.error) {
        reject(new Error(e.data.error));
        return;
      }
      resolve(e.data);
    };

    worker.addEventListener('message', handleMessage);
    worker.postMessage(
      {
        type: 'PROCESS_MAP',
        pgmBuffer,
        yaml: metadata,
        useOptimized: options.useOptimizedParser ?? pgmBuffer.byteLength > 5 * 1024 * 1024,
        pgmQuality: options.pgmQuality,
      } as MapWorkerRequest,
      [pgmBuffer]
    );
  });
};

export async function loadMapAssets(
  options: LoadMapAssetsOptions
): Promise<ProcessedMapDataWithBitmap> {
  const { mapId, cacheEnabled = true, timeout = CACHE_CONFIG.DEFAULT_TIMEOUT } = options;
  const cacheKey = cacheKeyForMap(mapId);

  if (cacheEnabled) {
    const cached = getFromCache(cacheKey);
    if (cached) return cached;
  }

  const loadingPromise = (async () => {
    try {
      const mapResponse = await apiClient.get<{
        success: boolean;
        data?: {
          metadata: MapYamlMetadata;
          features?: ProcessedMapData['features'];
        };
      }>(`maps/${mapId}`);

      if (!mapResponse.success || !mapResponse.data) {
        throw new Error('Failed to load map metadata');
      }

      const { metadata, features } = mapResponse.data;

      const pgmResponse = await api.get(`maps/${mapId}/image`, {
        timeout,
        retry: options.retryFailedOperations ? (options.maxRetries ?? 3) : 0,
      });

      if (!pgmResponse.ok) {
        throw new Error(`Failed to load map PGM: ${pgmResponse.status}`);
      }

      const pgmBuffer = await pgmResponse.arrayBuffer();
      const result = await processMapInWorker(pgmBuffer, metadata, options);

      return {
        imageData: {
          width: result.width,
          height: result.height,
          data: new Uint8ClampedArray(0),
        },
        meta: {
          width: result.width,
          height: result.height,
          resolution: Number(metadata.resolution ?? 0.05),
          origin: (metadata.origin ?? [0, 0, 0]) as [number, number, number],
          occupiedThresh: Number(metadata.occupied_thresh ?? 0.65),
          freeThresh: Number(metadata.free_thresh ?? 0.196),
        },
        imageBitmap: result.bitmap,
        features,
      } as ProcessedMapDataWithBitmap;
    } catch (error) {
      removeFromCache(cacheKey);
      throw error;
    }
  })();

  if (cacheEnabled) {
    addToCache(cacheKey, loadingPromise);
  }

  return loadingPromise;
}

export function clearMapAssetCache(): void {
  mapCache.clear();
  cacheAccessOrder.clear();
  accessCounter = 0;
}

export function evictFromCache(mapId: string): void {
  removeFromCache(cacheKeyForMap(mapId));
}

export function getCacheStats(): { size: number; keys: string[]; maxSize: number } {
  return {
    size: mapCache.size,
    keys: Array.from(mapCache.keys()),
    maxSize: CACHE_CONFIG.MAX_SIZE,
  };
}

export { loadMapAssets as default };
