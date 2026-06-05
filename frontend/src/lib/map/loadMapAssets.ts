import type { MapYamlMetadata, ProcessedMapData } from '@tensrai/shared';
import { apiClient, resolveApiHttpBase } from '../api';
import type { MapWorkerRequest, MapWorkerResponse } from './map.worker';
import MapWorker from './map.worker?worker';

export interface ProcessedMapDataWithBitmap extends ProcessedMapData {
  imageBitmap?: ImageBitmap;
  imageElement?: HTMLImageElement;
  contentHash?: string;
  source?: 'webp' | 'png' | 'pgm';
}

export type MapLoadPhase =
  | 'checking-cache'
  | 'fetching-metadata'
  | 'downloading-display'
  | 'downloading-pgm-fallback'
  | 'decoding'
  | 'ready'
  | 'failed';

export type MapLoadProgress = {
  phase: MapLoadPhase;
  progress?: number;
  bytesReceived?: number;
  totalBytes?: number;
  source?: 'webp' | 'png' | 'pgm';
  message?: string;
};

export interface LoadMapAssetsOptions {
  mapId: string;
  cacheEnabled?: boolean;
  timeout?: number;
  useOptimizedParser?: boolean;
  pgmQuality?: number;
  chunkSize?: number;
  progressCallback?: (progress: MapLoadProgress) => void;
  retryFailedOperations?: boolean;
  maxRetries?: number;
}

type MapMetadataResponse = {
  success: boolean;
  data?: {
    metadata: MapYamlMetadata;
    features?: ProcessedMapData['features'];
    contentHash?: string | null;
    pixelWidth?: number | null;
    pixelHeight?: number | null;
    imageSizeBytes?: number | null;
    displayAssets?: {
      webp?: boolean;
      png?: boolean;
      displayWebpSizeBytes?: number | null;
      displayPngSizeBytes?: number | null;
      error?: string | null;
    };
  };
};

const CACHE_CONFIG = {
  MAX_SIZE: 10,
  DEFAULT_TIMEOUT: 30000,
};

const mapCache = new Map<string, { promise: Promise<ProcessedMapDataWithBitmap>; at: number }>();
const cacheAccessOrder = new Map<string, number>();
let accessCounter = 0;

let mapWorker: Worker | null = null;
let mapWorkerRequestId = 0;

const cacheKeyForMap = (mapId: string, contentHash?: string | null) =>
  `map_${mapId}_${contentHash || 'nohash'}`;

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
    mapWorkerRequestId += 1;
    const requestId = mapWorkerRequestId;
    const cleanup = () => {
      worker.removeEventListener('message', handleMessage);
      window.clearTimeout(timeoutId);
    };
    const handleMessage = (e: MessageEvent<MapWorkerResponse>) => {
      if (e.data.requestId !== requestId) return;
      if (e.data.type === 'MAP_PROGRESS') {
        options.progressCallback?.({
          phase: 'decoding',
          progress: 75 + ((e.data.progress ?? 0) / 100) * 20,
          source: 'pgm',
        });
        return;
      }
      if (e.data.type !== 'MAP_PROCESSED') return;
      cleanup();
      if (e.data.error) {
        reject(new Error(e.data.error));
        return;
      }
      resolve(e.data);
    };
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error('Map worker timed out'));
    }, options.timeout ?? CACHE_CONFIG.DEFAULT_TIMEOUT);

    worker.addEventListener('message', handleMessage);
    worker.postMessage(
      {
        type: 'PROCESS_MAP',
        requestId,
        pgmBuffer,
        yaml: metadata,
        useOptimized: options.useOptimizedParser ?? pgmBuffer.byteLength > 5 * 1024 * 1024,
        pgmQuality: options.pgmQuality,
      } as MapWorkerRequest,
      [pgmBuffer]
    );
  });
};

const buildAssetPath = (mapId: string, path: string, contentHash?: string | null) => {
  const rev = contentHash ? `?rev=${encodeURIComponent(contentHash)}` : '';
  return `maps/${mapId}/${path}${rev}`;
};

const wait = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

const downloadBinaryOnce = async (
  path: string,
  options: LoadMapAssetsOptions,
  progress: Omit<MapLoadProgress, 'bytesReceived' | 'totalBytes' | 'progress'>
) => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    options.timeout ?? CACHE_CONFIG.DEFAULT_TIMEOUT
  );
  try {
    const response = await fetch(`${resolveApiHttpBase()}/${path}`, {
      credentials: 'include',
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const totalBytesHeader = response.headers.get('content-length');
    const totalBytes = totalBytesHeader ? Number(totalBytesHeader) : undefined;
    const reader = response.body?.getReader();
    if (!reader) {
      const buffer = await response.arrayBuffer();
      options.progressCallback?.({
        ...progress,
        bytesReceived: buffer.byteLength,
        ...(totalBytes ? { totalBytes, progress: 100 } : {}),
      });
      return {
        bytes: new Uint8Array(buffer),
        contentType: response.headers.get('content-type') ?? undefined,
      };
    }

    const chunks: Uint8Array[] = [];
    let bytesReceived = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        bytesReceived += value.byteLength;
        options.progressCallback?.({
          ...progress,
          bytesReceived,
          ...(totalBytes
            ? { totalBytes, progress: Math.min(74, (bytesReceived / totalBytes) * 70) }
            : {}),
        });
      }
    }

    const bytes = new Uint8Array(bytesReceived);
    let offset = 0;
    chunks.forEach(chunk => {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    });
    return {
      bytes,
      contentType: response.headers.get('content-type') ?? undefined,
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
};

const downloadBinary = async (
  path: string,
  options: LoadMapAssetsOptions,
  progress: Omit<MapLoadProgress, 'bytesReceived' | 'totalBytes' | 'progress'>
) => {
  const attempts = options.retryFailedOperations ? (options.maxRetries ?? 3) + 1 : 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await downloadBinaryOnce(path, options, progress);
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) break;
      await wait(250 * (attempt + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Map download failed');
};

const createImageFromBytes = async (bytes: Uint8Array, contentType?: string) => {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  const blob = new Blob([copy], { type: contentType ?? 'image/png' });
  if ('createImageBitmap' in window) {
    try {
      return { imageBitmap: await createImageBitmap(blob) };
    } catch {
      // Fall back to HTMLImageElement below.
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const imageElement = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to decode map display image'));
      img.src = url;
    });
    return { imageElement };
  } finally {
    URL.revokeObjectURL(url);
  }
};

const loadDisplayAsset = async (
  mapId: string,
  metadata: MapMetadataResponse['data'],
  format: 'webp' | 'png',
  options: LoadMapAssetsOptions
) => {
  if (!metadata?.displayAssets?.[format]) return null;
  const bytes = await downloadBinary(
    buildAssetPath(mapId, `display/${format}`, metadata.contentHash),
    options,
    {
      phase: 'downloading-display',
      source: format,
      message: `Downloading ${format.toUpperCase()} map`,
    }
  );
  options.progressCallback?.({ phase: 'decoding', progress: 92, source: format });
  const image = await createImageFromBytes(bytes.bytes, bytes.contentType);
  const width = Number(metadata.pixelWidth ?? 0);
  const height = Number(metadata.pixelHeight ?? 0);
  if (!width || !height) {
    throw new Error('Map display asset is missing dimensions');
  }
  return {
    image,
    width,
    height,
  };
};

const mapResultFromDisplay = (
  metadata: MapMetadataResponse['data'],
  display: NonNullable<Awaited<ReturnType<typeof loadDisplayAsset>>>,
  source: 'webp' | 'png'
): ProcessedMapDataWithBitmap => {
  const result: ProcessedMapDataWithBitmap = {
    imageData: {
      width: display.width,
      height: display.height,
      data: new Uint8ClampedArray(0),
    },
    meta: {
      width: display.width,
      height: display.height,
      resolution: Number(metadata?.metadata.resolution ?? 0.05),
      origin: (metadata?.metadata.origin ?? [0, 0, 0]) as [number, number, number],
      occupiedThresh: Number(metadata?.metadata.occupied_thresh ?? 0.65),
      freeThresh: Number(metadata?.metadata.free_thresh ?? 0.196),
    },
    source,
  };

  if (display.image.imageBitmap) result.imageBitmap = display.image.imageBitmap;
  if (display.image.imageElement) result.imageElement = display.image.imageElement;
  if (metadata?.features) result.features = metadata.features;
  if (metadata?.contentHash) result.contentHash = metadata.contentHash;

  return result;
};

export async function loadMapAssets(
  options: LoadMapAssetsOptions
): Promise<ProcessedMapDataWithBitmap> {
  const { mapId, cacheEnabled = true, timeout = CACHE_CONFIG.DEFAULT_TIMEOUT } = options;
  options.progressCallback?.({ phase: 'fetching-metadata', progress: 2 });

  const mapResponse = await apiClient.get<MapMetadataResponse>(`maps/${mapId}`, { timeout });

  if (!mapResponse.success || !mapResponse.data) {
    throw new Error('Failed to load map metadata');
  }

  const mapData = mapResponse.data;
  const { metadata, features } = mapData;
  const cacheKey = cacheKeyForMap(mapId, mapData.contentHash);

  if (cacheEnabled) {
    options.progressCallback?.({ phase: 'checking-cache', progress: 5 });
    const cached = getFromCache(cacheKey);
    if (cached) {
      options.progressCallback?.({ phase: 'ready', progress: 100 });
      return cached;
    }
  }

  const loadingPromise = (async () => {
    try {
      for (const format of ['webp', 'png'] as const) {
        try {
          const display = await loadDisplayAsset(mapId, mapData, format, options);
          if (display) {
            options.progressCallback?.({ phase: 'ready', progress: 100, source: format });
            return mapResultFromDisplay(mapData, display, format);
          }
        } catch (error) {
          if (format === 'png') {
            console.warn('Map display asset failed, falling back to PGM', error);
          }
        }
      }

      const pgmDownload = await downloadBinary(
        buildAssetPath(mapId, 'image', mapData.contentHash),
        options,
        {
          phase: 'downloading-pgm-fallback',
          source: 'pgm',
          message: 'Downloading raw PGM map',
        }
      );
      const pgmBuffer = pgmDownload.bytes.buffer.slice(
        pgmDownload.bytes.byteOffset,
        pgmDownload.bytes.byteOffset + pgmDownload.bytes.byteLength
      );
      const result = await processMapInWorker(pgmBuffer, metadata, options);

      if (!result.width || !result.height || !result.bitmap) {
        throw new Error('Map worker returned incomplete data');
      }

      options.progressCallback?.({ phase: 'ready', progress: 100, source: 'pgm' });
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
        ...(features ? { features } : {}),
        ...(mapData.contentHash ? { contentHash: mapData.contentHash } : {}),
        source: 'pgm',
      } as ProcessedMapDataWithBitmap;
    } catch (error) {
      removeFromCache(cacheKey);
      options.progressCallback?.({
        phase: 'failed',
        message: error instanceof Error ? error.message : 'Failed to load map',
      });
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
  for (const key of Array.from(mapCache.keys())) {
    if (key.startsWith(`map_${mapId}_`)) {
      removeFromCache(key);
    }
  }
}

export function getCacheStats(): { size: number; keys: string[]; maxSize: number } {
  return {
    size: mapCache.size,
    keys: Array.from(mapCache.keys()),
    maxSize: CACHE_CONFIG.MAX_SIZE,
  };
}

export { loadMapAssets as default };
