// Memory Manager Types

export interface MemoryStats {
  total: number;
  used: number;
  free: number;
  usagePercent: number;
  timestamp: Date;
}

export interface MemoryManagerConfig {
  maxMemoryMb: number;
  evictionPolicy: 'lru' | 'fifo' | 'none';
  cleanupIntervalMs?: number;
}

export interface ResourceTracker {
  resourceId: string;
  sizeBytes: number;
  lastAccessed: Date;
  createdAt: Date;
}
