/**
 * Memory Management Service
 * Handles memory optimization, cleanup, and monitoring
 */

export interface MemoryStats {
  used: number;
  total: number;
  percentage: number;
  limit: number;
}

export interface MemoryManagerConfig {
  enableMonitoring: boolean;
  memoryLimit: number;
  cleanupInterval: number;
  warnThreshold: number;
  emergencyThreshold: number;
  autoCleanup: boolean;
}

export interface ResourceTracker {
  id: string;
  type: 'canvas' | 'image' | 'buffer' | 'timer' | 'websocket' | 'animation';
  size: number;
  createdAt: Date;
  lastAccessed: Date;
  ref?: any;
  cleanup?: () => void;
}

let config: MemoryManagerConfig = {
  enableMonitoring: true,
  memoryLimit: 512,
  cleanupInterval: 30000,
  warnThreshold: 70,
  emergencyThreshold: 90,
  autoCleanup: true,
};

const resources = new Map<string, ResourceTracker>();
let cleanupTimer: number | null = null;

const stats: MemoryStats = {
  used: 0,
  total: 0,
  percentage: 0,
  limit: config.memoryLimit * 1024 * 1024,
};

/**
 * Update memory statistics
 */
function updateStats(): void {
  let totalSize = 0;
  for (const tracker of Array.from(resources.values())) {
    totalSize += tracker.size;
  }

  stats.used = totalSize;
  stats.percentage = (totalSize / stats.limit) * 100;

  if (stats.percentage > config.emergencyThreshold) {
    console.error(`🚨 EMERGENCY: Memory usage at ${stats.percentage.toFixed(1)}%`);
    emergencyCleanup();
  } else if (stats.percentage > config.warnThreshold) {
    console.warn(`⚠️ WARNING: Memory usage at ${stats.percentage.toFixed(1)}%`);
  }
}

/**
 * Check memory usage and take action
 */
function checkMemoryUsage(): void {
  if ('memory' in performance) {
    const browserMemory = (performance as any).memory;
    stats.total = browserMemory.usedJSHeapSize;
  }
}

/**
 * Clean up a specific resource
 */
function cleanupResource(tracker: ResourceTracker): void {
  try {
    if (tracker.cleanup) {
      tracker.cleanup();
    }

    switch (tracker.type) {
      case 'canvas':
        if (tracker.ref) {
          const canvas = tracker.ref as HTMLCanvasElement;
          canvas.width = 0;
          canvas.height = 0;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, 0, 0);
          }
        }
        break;

      case 'image':
        if (tracker.ref) {
          const img = tracker.ref as HTMLImageElement;
          img.src = '';
          img.onload = null;
          img.onerror = null;
        }
        break;

      case 'timer':
        if (tracker.ref) {
          clearTimeout(tracker.ref as number);
        }
        break;

      case 'websocket':
        if (tracker.ref) {
          const ws = tracker.ref as WebSocket;
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close();
          }
        }
        break;

      case 'animation':
        if (tracker.ref) {
          cancelAnimationFrame(tracker.ref as number);
        }
        break;

      case 'buffer':
        if (tracker.ref) {
          const buffer = tracker.ref as ArrayBuffer;
          (buffer as any).byteLength = 0;
        }
        break;
    }
  } catch (error) {
    console.error(`Error cleaning up resource ${tracker.id}:`, error);
  }
}

/**
 * Unregister and cleanup a resource
 */
export function unregisterResource(id: string): void {
  const tracker = resources.get(id);
  if (tracker) {
    cleanupResource(tracker);
    resources.delete(id);
    updateStats();
  }
}

/**
 * Clean up oldest resources by type
 */
function cleanupOldestResources(): void {
  const sortedResources = Array.from(resources.values()).sort(
    (a, b) => a.lastAccessed.getTime() - b.lastAccessed.getTime()
  );

  const targetSize = Math.floor(sortedResources.length * 0.2);
  const toCleanup = sortedResources.slice(0, targetSize);

  toCleanup.forEach(tracker => {
    console.debug(`Cleaning up old resource: ${tracker.id} (${tracker.type})`);
    unregisterResource(tracker.id);
  });
}

/**
 * Perform automatic cleanup
 */
function performAutoCleanup(): void {
  const now = Date.now();
  const inactiveThreshold = 5 * 60 * 1000;
  const oldThreshold = 30 * 60 * 1000;

  const inactiveResources = Array.from(resources.values()).filter(
    tracker => now - tracker.lastAccessed.getTime() > inactiveThreshold
  );

  const veryOldResources = Array.from(resources.values()).filter(
    tracker => now - tracker.createdAt.getTime() > oldThreshold
  );

  inactiveResources.forEach(tracker => {
    console.debug(`Cleaning up inactive resource: ${tracker.id} (${tracker.type})`);
    unregisterResource(tracker.id);
  });

  veryOldResources.forEach(tracker => {
    if (!inactiveResources.includes(tracker)) {
      console.debug(`Cleaning up old resource: ${tracker.id} (${tracker.type})`);
      unregisterResource(tracker.id);
    }
  });

  if (stats.percentage > config.warnThreshold) {
    cleanupOldestResources();
  }
}

/**
 * Emergency cleanup
 */
function emergencyCleanup(): void {
  console.error('🚨 Performing emergency memory cleanup');

  const resourcesList = Array.from(resources.values());
  resourcesList.forEach(tracker => {
    console.error(`Emergency cleanup: ${tracker.id} (${tracker.type})`);
    unregisterResource(tracker.id);
  });

  if ((window as any).gc) {
    (window as any).gc();
  }
}

/**
 * Start memory monitoring
 */
function startMonitoring(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
  }

  cleanupTimer = window.setInterval(() => {
    updateStats();
    checkMemoryUsage();
    if (config.autoCleanup) {
      performAutoCleanup();
    }
  }, config.cleanupInterval);
}

/**
 * Stop monitoring
 */
export function stopMonitoring(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

/**
 * Register a resource for tracking
 */
export function registerResource(
  id: string,
  type: ResourceTracker['type'],
  size: number,
  ref?: any,
  cleanup?: () => void
): void {
  const tracker: any = {
    id,
    type,
    size,
    createdAt: new Date(),
    lastAccessed: new Date(),
    ref,
  };

  if (cleanup) {
    tracker.cleanup = cleanup;
  }

  resources.set(id, tracker);
  updateStats();
}

/**
 * Update resource access time
 */
export function updateAccess(id: string): void {
  const tracker = resources.get(id);
  if (tracker) {
    tracker.lastAccessed = new Date();
  }
}

/**
 * Get resource tracker
 */
export function getResource(id: string): ResourceTracker | undefined {
  return resources.get(id);
}

/**
 * Get resources by type
 */
export function getResourcesByType(type: ResourceTracker['type']): ResourceTracker[] {
  return Array.from(resources.values()).filter(r => r.type === type);
}

/**
 * Get all resources
 */
export function getAllResources(): ResourceTracker[] {
  return Array.from(resources.values());
}

/**
 * Get memory statistics
 */
export function getStats(): MemoryStats {
  return { ...stats };
}

/**
 * Get memory usage report
 */
export function getMemoryReport(): {
  stats: MemoryStats;
  resources: ResourceTracker[];
  byType: Record<string, ResourceTracker[]>;
  recommendations: string[];
} {
  const byType: Record<string, ResourceTracker[]> = {};

  for (const tracker of Array.from(resources.values())) {
    if (!byType[tracker.type]) {
      byType[tracker.type] = [];
    }
    byType[tracker.type].push(tracker);
  }

  const recommendations: string[] = [];

  if (stats.percentage > 80) {
    recommendations.push('Memory usage is very high. Consider reducing resource limits.');
  }

  if (byType['canvas'] && byType['canvas'].length > 10) {
    recommendations.push('High number of canvas elements. Consider reusing or pooling.');
  }

  if (byType['image'] && byType['image'].length > 50) {
    recommendations.push('High number of image elements. Consider lazy loading or caching.');
  }

  return {
    stats: getStats(),
    resources: getAllResources(),
    byType,
    recommendations,
  };
}

/**
 * Estimate resource size
 */
export function estimateResourceSize(type: ResourceTracker['type'], resource: any): number {
  switch (type) {
    case 'canvas':
      if (resource?.width && resource.height) {
        return resource.width * resource.height * 4; // 4 bytes per pixel
      }
      return 1024 * 1024; // 1MB default

    case 'image':
      if (resource?.src) {
        return 1024 * 512; // 512KB estimate
      }
      return 1024 * 256; // 256KB default

    case 'buffer':
      if (resource?.byteLength) {
        return resource.byteLength;
      }
      return 1024;

    case 'websocket':
    case 'timer':
    case 'animation':
      return 1024; // 1KB overhead

    default:
      return 512; // 512 bytes default
  }
}

/**
 * Cleanup all resources
 */
export function cleanup(): void {
  stopMonitoring();

  const resourcesList = Array.from(resources.values());
  resourcesList.forEach(tracker => {
    cleanupResource(tracker);
  });

  resources.clear();
  updateStats();
}

/**
 * Update configuration
 */
export function updateConfig(newConfig: Partial<MemoryManagerConfig>): void {
  config = { ...config, ...newConfig };
  stats.limit = config.memoryLimit * 1024 * 1024;

  if (config.enableMonitoring && !cleanupTimer) {
    startMonitoring();
  } else if (!config.enableMonitoring && cleanupTimer) {
    stopMonitoring();
  }
}

if (config.enableMonitoring) {
  startMonitoring();
}

/**
 * Hook for accessing memory manager
 */
export function useMemoryManager() {
  return {
    registerResource: (
      id: string,
      type: ResourceTracker['type'],
      ref?: any,
      cleanup?: () => void
    ) => {
      const size = estimateResourceSize(type, ref);
      registerResource(id, type, size, ref, cleanup);
    },
    unregisterResource,
    updateAccess,
    getStats,
    getReport: getMemoryReport,
    cleanup,
  };
}

export const memoryManager = {
  getInstance: (initialConfig?: Partial<MemoryManagerConfig>) => {
    if (initialConfig) {
      updateConfig(initialConfig);
    }
    return {
      registerResource,
      unregisterResource,
      updateAccess,
      getResource,
      getResourcesByType,
      getAllResources,
      getStats,
      getMemoryReport,
      estimateResourceSize,
      cleanup,
    };
  },
  reset: cleanup,
};
