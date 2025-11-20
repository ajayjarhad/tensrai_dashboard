/**
 * State Synchronization Types
 * Type definitions for cross-phase state synchronization and consistency
 */

export interface SyncOperation {
  id: string;
  type: 'create' | 'update' | 'delete';
  entityType: 'map' | 'robot' | 'layer' | 'assignment' | 'viewport';
  entityId: string;
  data?: Record<string, unknown>;
  previousData?: Record<string, unknown> | undefined;
  timestamp: number;
  source: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

export interface SyncConfig {
  enableRealTimeSync: boolean;
  syncInterval: number; // ms
  maxPendingOperations: number;
  retryFailedOperations: boolean;
  maxRetries: number;
  conflictResolution: 'last-write-wins' | 'merge' | 'manual';
  enableConflictDetection: boolean;
  syncTimeout: number; // ms
}

export interface SyncStats {
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  conflictsDetected: number;
  averageSyncTime: number;
  pendingOperations: number;
  lastSyncTime: number | null;
}
