/**
 * Performance Optimizer Service
 * Handles rate limiting, debouncing, and performance monitoring
 */

export interface PerformanceConfig {
  enableRateLimiting: boolean;
  enableDebouncing: boolean;
  enableThrottling: boolean;
  enableBatching: boolean;
  maxBatchSize: number;
  batchInterval: number; // ms
  debounceDelay: number; // ms
  throttleDelay: number; // ms
  maxFPS: number;
  frameTimeThreshold: number; // ms
  enableMemoryMonitoring: boolean;
  memoryCleanupInterval: number; // ms
}

export interface PerformanceStats {
  fps: number;
  frameTime: number;
  memoryUsage: {
    used: number;
    total: number;
    percentage: number;
  };
  batchedOperations: number;
  skippedFrames: number;
  averageUpdateTime: number;
  updateCount: number;
}

export interface BatchedOperation {
  id: string;
  type: string;
  data: any;
  timestamp: number;
  priority: 'low' | 'medium' | 'high';
}

let config: PerformanceConfig = {
  enableRateLimiting: true,
  enableDebouncing: true,
  enableThrottling: true,
  enableBatching: true,
  maxBatchSize: 50,
  batchInterval: 16, // ~60fps
  debounceDelay: 100,
  throttleDelay: 16, // ~60fps
  maxFPS: 60,
  frameTimeThreshold: 16.67, // 60fps target
  enableMemoryMonitoring: true,
  memoryCleanupInterval: 30000, // 30 seconds
};

const stats: PerformanceStats = {
  fps: 0,
  frameTime: 0,
  memoryUsage: { used: 0, total: 0, percentage: 0 },
  batchedOperations: 0,
  skippedFrames: 0,
  averageUpdateTime: 0,
  updateCount: 0,
};

// Rate limiting
const rateLimiters = new Map<
  string,
  { count: number; resetTime: number; limit: number; interval: number }
>();

// Debouncing
const debounceTimers = new Map<string, number>();

// Throttling
const throttleTimers = new Map<string, { lastCall: number; limit: number }>();

// Batching
let batchQueue: BatchedOperation[] = [];
let batchTimer: number | null = null;

// Frame monitoring
let frameCount = 0;
let lastFrameTime = performance.now();
let frameTimeHistory: number[] = [];
let updateTimes: number[] = [];

// Memory monitoring
let memoryMonitorTimer: number | null = null;

/**
 * Rate limit a function
 */
export function rateLimit<T extends (...args: any[]) => any>(
  key: string,
  fn: T,
  limit: number,
  interval: number = 1000
): (...args: Parameters<T>) => void {
  return (...args: Parameters<T>) => {
    if (!config.enableRateLimiting) {
      fn(...args);
      return;
    }

    const now = Date.now();
    const rateLimiter = rateLimiters.get(key);

    if (!rateLimiter || now > rateLimiter.resetTime) {
      // Reset or create rate limiter
      rateLimiters.set(key, {
        count: 1,
        resetTime: now + interval,
        limit,
        interval,
      });
      fn(...args);
    } else if (rateLimiter.count < rateLimiter.limit) {
      rateLimiter.count++;
      fn(...args);
    } else {
      console.debug(`Rate limit exceeded for ${key} (${rateLimiter.count}/${rateLimiter.limit})`);
    }
  };
}

/**
 * Debounce a function
 */
export function debounce<T extends (...args: any[]) => any>(
  key: string,
  fn: T,
  delay?: number
): (...args: Parameters<T>) => void {
  return (...args: Parameters<T>) => {
    if (!config.enableDebouncing) {
      fn(...args);
      return;
    }

    const actualDelay = delay ?? config.debounceDelay;

    // Clear existing timer
    const existingTimer = debounceTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new timer
    const timer = window.setTimeout(() => {
      debounceTimers.delete(key);
      fn(...args);
    }, actualDelay);

    debounceTimers.set(key, timer);
  };
}

/**
 * Throttle a function
 */
export function throttle<T extends (...args: any[]) => any>(
  key: string,
  fn: T,
  delay?: number
): (...args: Parameters<T>) => void {
  return (...args: Parameters<T>) => {
    if (!config.enableThrottling) {
      fn(...args);
      return;
    }

    const actualDelay = delay ?? config.throttleDelay;
    const now = Date.now();

    let throttleInfo = throttleTimers.get(key);
    if (!throttleInfo) {
      throttleInfo = { lastCall: 0, limit: actualDelay };
      throttleTimers.set(key, throttleInfo);
    }

    if (now - throttleInfo.lastCall >= throttleInfo.limit) {
      throttleInfo.lastCall = now;
      fn(...args);
    }
  };
}

/**
 * Process batched operations
 */
function processBatch(): void {
  if (batchTimer) {
    clearTimeout(batchTimer);
    batchTimer = null;
  }

  if (batchQueue.length === 0) {
    return;
  }

  const batch = batchQueue.splice(0, config.maxBatchSize);
  stats.batchedOperations += batch.length;

  // Group by operation type
  const grouped = new Map<string, any[]>();
  for (const operation of batch) {
    if (!grouped.has(operation.type)) {
      grouped.set(operation.type, []);
    }
    grouped.get(operation.type)?.push(operation.data);
  }

  // Process grouped operations
  for (const [type, data] of Array.from(grouped)) {
    try {
      // This would be implemented by specific services
      console.debug(`Processing batched ${type} operations:`, data.length);
    } catch (error) {
      console.error(`Error processing batched ${type} operations:`, error);
    }
  }
}

/**
 * Add operation to batch
 */
export function batch<T extends (...args: any[]) => any>(
  key: string,
  fn: T,
  data: any,
  priority: BatchedOperation['priority'] = 'medium'
): void {
  if (!config.enableBatching) {
    fn(data);
    return;
  }

  const operation: BatchedOperation = {
    id: `${key}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type: key,
    data,
    timestamp: Date.now(),
    priority,
  };

  batchQueue.push(operation);

  // Sort by priority
  batchQueue.sort((a, b) => {
    const priorityOrder = { high: 3, medium: 2, low: 1 };
    return priorityOrder[b.priority] - priorityOrder[a.priority];
  });

  // Start batch timer if not running
  if (!batchTimer) {
    batchTimer = window.setTimeout(() => {
      processBatch();
    }, config.batchInterval);
  }

  // Process immediately if queue is full
  if (batchQueue.length >= config.maxBatchSize) {
    processBatch();
  }
}

/**
 * Update frame statistics
 */
function updateFrameStats(): void {
  if (frameTimeHistory.length === 0) return;

  const avgFrameTime =
    frameTimeHistory.reduce((sum, time) => sum + time, 0) / frameTimeHistory.length;
  stats.frameTime = avgFrameTime;
  stats.fps = 1000 / avgFrameTime;

  // Update memory stats
  if ('memory' in performance) {
    const memory = (performance as any).memory;
    stats.memoryUsage = {
      used: memory.usedJSHeapSize,
      total: memory.totalJSHeapSize,
      percentage: (memory.usedJSHeapSize / memory.totalJSHeapSize) * 100,
    };
  }
}

/**
 * Monitor frame performance
 */
function startFrameMonitoring(): void {
  const monitorFrame = () => {
    const now = performance.now();
    const frameTime = now - lastFrameTime;

    frameTimeHistory.push(frameTime);
    if (frameTimeHistory.length > 60) {
      frameTimeHistory.shift();
    }

    // Update stats
    frameCount++;
    if (frameCount % 10 === 0) {
      updateFrameStats();
    }

    lastFrameTime = now;

    // Skip frame if it's taking too long
    if (frameTime > config.frameTimeThreshold * 2) {
      stats.skippedFrames++;
    }

    requestAnimationFrame(monitorFrame);
  };

  requestAnimationFrame(monitorFrame);
}

/**
 * Clean up old entries
 */
function cleanupOldEntries(): void {
  const now = Date.now();

  // Clean up old rate limiters
  for (const [key, rateLimiter] of Array.from(rateLimiters)) {
    if (now > rateLimiter.resetTime + rateLimiter.interval) {
      rateLimiters.delete(key);
    }
  }

  // Clean up old throttle entries
  for (const [key, throttleInfo] of Array.from(throttleTimers)) {
    if (now - throttleInfo.lastCall > 300000) {
      // 5 minutes
      throttleTimers.delete(key);
    }
  }
}

/**
 * Trigger memory cleanup
 */
function triggerMemoryCleanup(): void {
  // Clear old debounce timers
  for (const [key, timer] of Array.from(debounceTimers)) {
    clearTimeout(timer);
    debounceTimers.delete(key);
  }

  // Clear old rate limiters
  const now = Date.now();
  for (const [key, rateLimiter] of Array.from(rateLimiters)) {
    if (now > rateLimiter.resetTime) {
      rateLimiters.delete(key);
    }
  }

  // Clear old throttle info
  for (const [key, throttleInfo] of Array.from(throttleTimers)) {
    if (now - throttleInfo.lastCall > 60000) {
      // 1 minute
      throttleTimers.delete(key);
    }
  }

  // Force garbage collection if available
  if ((window as any).gc) {
    (window as any).gc();
  }
}

/**
 * Check memory usage and trigger cleanup if needed
 */
function checkMemoryUsage(): void {
  if (!('memory' in performance)) return;

  const memory = (performance as any).memory;
  const usagePercentage = (memory.usedJSHeapSize / memory.totalJSHeapSize) * 100;

  if (usagePercentage > 80) {
    console.warn(`High memory usage detected: ${usagePercentage.toFixed(1)}%`);
    triggerMemoryCleanup();
  }

  // Clean up old timers and rate limiters
  cleanupOldEntries();
}

/**
 * Start memory monitoring
 */
function startMemoryMonitoring(): void {
  memoryMonitorTimer = window.setInterval(() => {
    checkMemoryUsage();
  }, config.memoryCleanupInterval);
}

/**
 * Record update time for performance tracking
 */
export function recordUpdateTime(updateTime: number): void {
  updateTimes.push(updateTime);
  if (updateTimes.length > 100) {
    updateTimes.shift();
  }

  stats.updateCount++;
  stats.averageUpdateTime = updateTimes.reduce((sum, time) => sum + time, 0) / updateTimes.length;
}

/**
 * Get performance statistics
 */
export function getStats(): PerformanceStats {
  return { ...stats };
}

/**
 * Check if performance is optimal
 */
export function isOptimal(): boolean {
  return (
    stats.fps >= config.maxFPS * 0.8 &&
    stats.frameTime <= config.frameTimeThreshold * 1.5 &&
    stats.memoryUsage.percentage < 80
  );
}

/**
 * Get performance recommendations
 */
export function getRecommendations(): string[] {
  const recommendations: string[] = [];

  if (stats.fps < config.maxFPS * 0.8) {
    recommendations.push('Consider reducing update frequency or enabling more aggressive batching');
  }

  if (stats.frameTime > config.frameTimeThreshold * 1.5) {
    recommendations.push('Frame time is high, consider optimizing render operations');
  }

  if (stats.memoryUsage.percentage > 80) {
    recommendations.push('Memory usage is high, consider implementing more aggressive cleanup');
  }

  if (stats.skippedFrames > 5) {
    recommendations.push('Multiple frames skipped, consider reducing operation complexity');
  }

  if (stats.averageUpdateTime > 16) {
    recommendations.push('Average update time is high, consider optimizing update logic');
  }

  return recommendations;
}

/**
 * Update configuration
 */
export function updateConfig(newConfig: Partial<PerformanceConfig>): void {
  config = { ...config, ...newConfig };

  if (newConfig.memoryCleanupInterval && memoryMonitorTimer) {
    clearInterval(memoryMonitorTimer);
    if (config.enableMemoryMonitoring) {
      startMemoryMonitoring();
    }
  }
}

/**
 * Cleanup resources
 */
export function cleanup(): void {
  // Clear timers
  if (batchTimer) {
    clearTimeout(batchTimer);
  }
  if (memoryMonitorTimer) {
    clearInterval(memoryMonitorTimer);
  }

  // Clear debounce timers
  for (const timer of Array.from(debounceTimers.values())) {
    clearTimeout(timer);
  }

  // Clear data
  rateLimiters.clear();
  debounceTimers.clear();
  throttleTimers.clear();
  batchQueue = [];
  frameTimeHistory = [];
  updateTimes = [];
}

// Initialize monitoring
if (config.enableMemoryMonitoring) {
  startMemoryMonitoring();
}
startFrameMonitoring();

/**
 * Hook for accessing performance optimizer
 */
export function usePerformanceOptimizer() {
  return {
    rateLimit: <T extends (...args: any[]) => any>(
      key: string,
      fn: T,
      limit: number,
      interval?: number
    ) => rateLimit(key, fn, limit, interval),
    debounce: <T extends (...args: any[]) => any>(key: string, fn: T, delay?: number) =>
      debounce(key, fn, delay),
    throttle: <T extends (...args: any[]) => any>(key: string, fn: T, delay?: number) =>
      throttle(key, fn, delay),
    batch: <T extends (...args: any[]) => any>(
      key: string,
      fn: T,
      data: any,
      priority?: BatchedOperation['priority']
    ) => batch(key, fn, data, priority),
    recordUpdateTime,
    getStats,
    isOptimal,
    getRecommendations,
    updateConfig,
  };
}

/**
 * Backward compatibility object
 */
export const performanceOptimizer = {
  getInstance: (initialConfig?: Partial<PerformanceConfig>) => {
    if (initialConfig) {
      updateConfig(initialConfig);
    }
    return {
      rateLimit,
      debounce,
      throttle,
      batch,
      recordUpdateTime,
      getStats,
      isOptimal,
      getRecommendations,
      updateConfig,
      cleanup,
    };
  },
  reset: cleanup,
};
