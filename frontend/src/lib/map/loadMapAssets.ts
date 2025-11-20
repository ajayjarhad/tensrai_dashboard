/**
 * Map Asset Loading and Processing Utilities
 * Handles ROS map.yaml and .pgm files
 */

import type { MapYamlMetadata, ProcessedMapData } from '@tensrai/shared';
import { load } from 'js-yaml';
import { type ParsedPGM, parsePGM } from './pgm-parser';
import { type OptimizedPGMResult, parsePGMOptimized } from './pgm-parser-optimized';

// Union type for PGM parser results
type PGMResult = ParsedPGM | OptimizedPGMResult['parsedPGM'];

export interface LoadMapAssetsOptions {
  yamlPath: string;
  basePath?: string;
  cacheEnabled?: boolean;
  timeout?: number; // Timeout in milliseconds
  useOptimizedParser?: boolean; // Use optimized PGM parser for large files
  pgmQuality?: number; // Quality factor for PGM processing (1-100)
  chunkSize?: number; // Chunk size for processing large PGM files
  progressCallback?: (progress: number) => void; // Progress callback for long operations
  retryFailedOperations?: boolean; // Whether to retry failed operations
  maxRetries?: number; // Maximum number of retries
}

/**
 * Cache configuration for loaded map assets
 */
const CACHE_CONFIG = {
  MAX_SIZE: 10, // Maximum number of maps to cache
  DEFAULT_TIMEOUT: 30000, // 30 seconds timeout
};

// Module-level cache state
const cache = new Map<string, { promise: Promise<ProcessedMapData>; timestamp: number }>();
const accessOrder = new Map<string, number>();
let counter = 0;

/**
 * Get entry from cache
 */
function getFromCache(key: string): Promise<ProcessedMapData> | undefined {
  const entry = cache.get(key);
  if (entry) {
    // Update access order
    counter++;
    accessOrder.set(key, counter);
    return entry.promise;
  }
  return undefined;
}

/**
 * Evict oldest entry from cache
 */
function evictOldest(): void {
  let oldestKey: string | undefined;
  let oldestAccess = Infinity;

  for (const [key, accessTime] of Array.from(accessOrder.entries())) {
    if (accessTime < oldestAccess) {
      oldestAccess = accessTime;
      oldestKey = key;
    }
  }

  if (oldestKey) {
    deleteFromCache(oldestKey);
  }
}

/**
 * Add entry to cache
 */
function addToCache(key: string, promise: Promise<ProcessedMapData>): void {
  // Evict oldest entry if cache is full
  if (cache.size >= CACHE_CONFIG.MAX_SIZE) {
    evictOldest();
  }

  cache.set(key, { promise, timestamp: Date.now() });
  counter++;
  accessOrder.set(key, counter);
}

/**
 * Delete entry from cache
 */
function deleteFromCache(key: string): boolean {
  const deleted = cache.delete(key);
  accessOrder.delete(key);
  return deleted;
}

/**
 * Clear the cache
 */
function clearCache(): void {
  cache.clear();
  accessOrder.clear();
  counter = 0;
}

/**
 * Get all cache keys
 */
function getCacheKeys(): string[] {
  return Array.from(cache.keys());
}

/**
 * Get cache size
 */
function getCacheSize(): number {
  return cache.size;
}

/**
 * Load and process ROS map assets from YAML and PGM files
 * @param options Loading options including YAML path
 * @returns Promise resolving to processed map data
 */
/**
 * Delay utility for retry logic
 */
const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Create a fetch with timeout and retry logic
 */
async function fetchWithRetry(
  url: string,
  options: { timeout: number; maxRetries?: number; retryDelay?: number }
): Promise<Response> {
  const { timeout, maxRetries = 3, retryDelay = 1000 } = options;
  let lastError: Error;

  for (let attempt = 0; attempt < maxRetries + 1; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error instanceof Error ? error : new Error('Unknown fetch error');

      // Don't retry on certain error types
      if (
        error instanceof Error &&
        (error.name === 'AbortError' ||
          error.message.includes('404') ||
          error.message.includes('403'))
      ) {
        throw lastError;
      }

      // If this is the last attempt, throw the error
      if (attempt === maxRetries) {
        throw new Error(`Failed to fetch after ${maxRetries} retries: ${lastError.message}`);
      }

      // Wait before retry with exponential backoff
      await delay(retryDelay * 2 ** attempt);
    }
  }

  // This should never be reached, but provide a safe fallback
  throw new Error('Failed to fetch: Unknown error');
}

export async function loadMapAssets(options: LoadMapAssetsOptions): Promise<ProcessedMapData> {
  const {
    yamlPath,
    basePath = '',
    cacheEnabled = true,
    timeout = CACHE_CONFIG.DEFAULT_TIMEOUT,
  } = options;
  const cacheKey = `${basePath}${yamlPath}`;

  // Check cache first
  if (cacheEnabled) {
    const cachedPromise = getFromCache(cacheKey);
    if (cachedPromise) {
      return cachedPromise;
    }
  }

  // Create loading promise and cache it
  const loadingPromise = (async () => {
    try {
      // Load and parse YAML metadata with retry
      const yamlUrl = resolvePath(yamlPath, basePath);
      const yamlResponse = await fetchWithRetry(yamlUrl, {
        timeout,
        maxRetries: options.retryFailedOperations ? (options.maxRetries ?? 3) : 0,
        retryDelay: 1000,
      });

      if (!yamlResponse.ok) {
        throw new Error(`Failed to load map YAML: ${yamlUrl} (${yamlResponse.status})`);
      }

      const yamlText = await yamlResponse.text();
      const yamlMetadata = load(yamlText) as MapYamlMetadata;

      // Validate YAML metadata
      validateYamlMetadata(yamlMetadata);

      // Load PGM image data with retry
      const pgmUrl = resolvePath(yamlMetadata.image, yamlPath);
      const pgmResponse = await fetchWithRetry(pgmUrl, {
        timeout,
        maxRetries: options.retryFailedOperations ? (options.maxRetries ?? 3) : 0,
        retryDelay: 1000,
      });

      if (!pgmResponse.ok) {
        throw new Error(`Failed to load PGM image: ${pgmUrl} (${pgmResponse.status})`);
      }

      const pgmBuffer = await pgmResponse.arrayBuffer();

      // Use optimized parser for large files or when explicitly requested
      let parsedPGM: PGMResult;
      const useOptimized = options.useOptimizedParser ?? pgmBuffer.byteLength > 5 * 1024 * 1024; // Auto-use for files > 5MB

      if (useOptimized) {
        const processingOptions: any = {
          quality: options.pgmQuality || 100,
        };

        if (options.chunkSize !== undefined) {
          processingOptions.chunkSize = options.chunkSize;
        }

        if (options.progressCallback !== undefined) {
          processingOptions.progressCallback = options.progressCallback;
        }

        const optimizedResult = await parsePGMOptimized(pgmBuffer, processingOptions);
        parsedPGM = optimizedResult.parsedPGM;
      } else {
        parsedPGM = parsePGM(pgmBuffer);
      }

      // Convert PGM to ImageData with ROS occupancy semantics
      const imageData = convertPGMToImageData(parsedPGM, yamlMetadata);

      // Extract metadata for coordinate transformations
      const meta = {
        width: parsedPGM.width,
        height: parsedPGM.height,
        resolution: yamlMetadata.resolution,
        origin: yamlMetadata.origin,
        occupiedThresh: yamlMetadata.occupied_thresh ?? 0.65,
        freeThresh: yamlMetadata.free_thresh ?? 0.196,
      };

      return { imageData, meta };
    } catch (error) {
      // Remove from cache on error
      deleteFromCache(cacheKey);
      throw error;
    }
  })();

  if (cacheEnabled) {
    addToCache(cacheKey, loadingPromise);
  }

  return loadingPromise;
}

/**
 * Resolve a path relative to a base path or URL
 */
function resolvePath(path: string, basePath: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }

  const origin =
    typeof window !== 'undefined' && window.location ? window.location.origin : 'http://localhost';

  let viteBase = '/';
  try {
    // Safe access to import.meta.env.BASE_URL if available in the environment
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) {
      viteBase = import.meta.env.BASE_URL;
    }
  } catch {
    viteBase = '/';
  }

  const normalizedBase = viteBase.endsWith('/') ? viteBase : `${viteBase}/`;
  const baseOrigin =
    origin.replace(/\/$/, '') +
    (normalizedBase.startsWith('/') ? normalizedBase : `/${normalizedBase}`);

  const absoluteFromRoot = (relativePath: string) => {
    const cleaned = relativePath.replace(/^\/+/, '');
    return new URL(cleaned, baseOrigin).href;
  };

  if (path.startsWith('/')) {
    return absoluteFromRoot(path);
  }

  const baseUrl = basePath
    ? basePath.startsWith('http://') || basePath.startsWith('https://')
      ? basePath
      : absoluteFromRoot(basePath)
    : baseOrigin;

  const baseDir = baseUrl.endsWith('/')
    ? baseUrl
    : `${baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1)}`;

  return new URL(path, baseDir).href;
}

/**
 * Validate YAML metadata structure and values
 */
function validateYamlMetadata(metadata: MapYamlMetadata): void {
  if (!metadata.image) {
    throw new Error('Map YAML missing required "image" field');
  }

  if (typeof metadata.resolution !== 'number' || metadata.resolution <= 0) {
    throw new Error('Map YAML requires valid "resolution" > 0');
  }

  if (!Array.isArray(metadata.origin) || metadata.origin.length !== 3) {
    throw new Error('Map YAML requires "origin" as [x, y, yaw]');
  }

  metadata.origin.forEach((val, idx) => {
    if (typeof val !== 'number') {
      throw new Error(`Map YAML origin[${idx}] must be a number`);
    }
  });
}

/**
 * Convert PGM data to ImageData with ROS occupancy grid semantics
 */
function convertPGMToImageData(
  pgm: PGMResult,
  yaml: MapYamlMetadata
): {
  data: Uint8ClampedArray;
  width: number;
  height: number;
} {
  const { width, height, maxVal, data } = pgm;
  const { negate = 0 } = yaml;

  const rgbaBuffer = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < width * height; i++) {
    let intensity = data[i];

    // Normalize to 0-255 range if maxVal < 255
    if (maxVal !== 255) {
      intensity = Math.round((intensity / maxVal) * 255);
    }

    if (negate === 1) {
      intensity = 255 - intensity;
    }

    const pixelIndex = i * 4;
    rgbaBuffer[pixelIndex] = intensity;
    rgbaBuffer[pixelIndex + 1] = intensity;
    rgbaBuffer[pixelIndex + 2] = intensity;
    rgbaBuffer[pixelIndex + 3] = 255;
  }

  return {
    data: rgbaBuffer,
    width,
    height,
  };
}

/**
 * Clear the map asset cache
 */
export function clearMapAssetCache(): void {
  clearCache();
}

/**
 * Remove specific map from cache
 */
export function evictFromCache(yamlPath: string, basePath: string = ''): void {
  const cacheKey = `${basePath}${yamlPath}`;
  deleteFromCache(cacheKey);
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { size: number; keys: string[]; maxSize: number } {
  return {
    size: getCacheSize(),
    maxSize: CACHE_CONFIG.MAX_SIZE,
    keys: getCacheKeys(),
  };
}

// Re-export for explicit module resolution
export { loadMapAssets as default };
