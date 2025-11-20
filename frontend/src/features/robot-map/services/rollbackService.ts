/**
 * Rollback Service
 * Handles state rollback and recovery mechanisms
 */

import type { MapLayer, RobotInfo, ViewportState } from '@tensrai/shared';
import { useMultiMapStore } from '../stores/useMultiMapStore';

export interface Snapshot {
  id: string;
  timestamp: number;
  description: string;
  state: {
    maps: Map<string, any>;
    robots: Map<string, RobotInfo>;
    layers: Map<string, MapLayer>;
    assignments: Map<string, string>;
    viewports: Map<string, ViewportState>;
  };
  checksum: string;
}

export interface RollbackConfig {
  enabled: boolean;
  maxSnapshots: number;
  snapshotInterval: number; // ms
  autoRollbackOnFailure: boolean;
  snapshotRetentionTime: number; // ms
  enableCompression: boolean;
}

export interface RollbackStats {
  snapshotsCreated: number;
  rollbacksPerformed: number;
  rollbackSuccessCount: number;
  rollbackFailureCount: number;
  lastSnapshotTime: number | null;
  lastRollbackTime: number | null;
  averageSnapshotSize: number;
}

let config: RollbackConfig = {
  enabled: true,
  maxSnapshots: 10,
  snapshotInterval: 30000, // 30 seconds
  autoRollbackOnFailure: false,
  snapshotRetentionTime: 300000, // 5 minutes
  enableCompression: true,
};

const snapshots = new Map<string, Snapshot>();
let snapshotTimer: number | null = null;

const stats: RollbackStats = {
  snapshotsCreated: 0,
  rollbacksPerformed: 0,
  rollbackSuccessCount: 0,
  rollbackFailureCount: 0,
  lastSnapshotTime: null,
  lastRollbackTime: null,
  averageSnapshotSize: 0,
};

/**
 * Generate unique snapshot ID
 */
function generateSnapshotId(): string {
  return `snapshot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Calculate checksum for state integrity
 */
function calculateChecksum(state: any): string {
  const stateString = JSON.stringify(state);
  let hash = 0;
  for (let i = 0; i < stateString.length; i++) {
    const char = stateString.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(36);
}

/**
 * Compress state for storage (simple implementation)
 */
function compressState(state: any): any {
  // For now, just return the state as-is
  // In a real implementation, you might use a compression library
  return state;
}

/**
 * Decompress state (simple implementation)
 */
function decompressState(state: any): any {
  // For now, just return the state as-is
  // In a real implementation, you might decompress the data
  return state;
}

/**
 * Delay utility
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Update average snapshot size
 */
function updateAverageSnapshotSize(): void {
  if (snapshots.size === 0) {
    stats.averageSnapshotSize = 0;
    return;
  }

  const totalSize = Array.from(snapshots.values()).reduce(
    (sum, snapshot) => sum + JSON.stringify(snapshot.state).length,
    0
  );

  stats.averageSnapshotSize = totalSize / snapshots.size;
}

/**
 * Clean up old snapshots
 */
function cleanupOldSnapshots(): void {
  const now = Date.now();
  const cutoff = now - config.snapshotRetentionTime;

  // Remove old snapshots
  for (const [id, snapshot] of Array.from(snapshots)) {
    if (snapshot.timestamp < cutoff) {
      snapshots.delete(id);
    }
  }

  // If we still have too many snapshots, remove the oldest
  if (snapshots.size > config.maxSnapshots) {
    const sortedSnapshots = Array.from(snapshots.entries()).sort(
      ([, a], [, b]) => a.timestamp - b.timestamp
    );

    const toRemove = sortedSnapshots.slice(0, snapshots.size - config.maxSnapshots);
    for (const [id] of toRemove) {
      snapshots.delete(id);
    }
  }

  // Update average snapshot size
  updateAverageSnapshotSize();
}

/**
 * Create a snapshot of current state
 */
export function createSnapshot(description: string = 'Auto snapshot'): string {
  if (!config.enabled) {
    throw new Error('Rollback service is disabled');
  }

  try {
    const snapshotId = generateSnapshotId();
    const timestamp = Date.now();

    // Get current state from store
    const store = useMultiMapStore.getState();
    const state = {
      maps: new Map(store.maps),
      robots: new Map(store.robots),
      layers: new Map(store.layers),
      assignments: new Map(store.assignments),
      viewports: new Map(store.viewports),
    };

    // Create snapshot
    const snapshot: Snapshot = {
      id: snapshotId,
      timestamp,
      description,
      state: config.enableCompression ? compressState(state) : state,
      checksum: calculateChecksum(state),
    };

    // Store snapshot
    snapshots.set(snapshotId, snapshot);
    stats.snapshotsCreated++;
    stats.lastSnapshotTime = timestamp;

    // Cleanup old snapshots
    cleanupOldSnapshots();

    console.debug(`📸 Created snapshot ${snapshotId}: ${description}`);
    return snapshotId;
  } catch (error) {
    console.error('Failed to create snapshot:', error);
    throw new Error(
      `Snapshot creation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Rollback to a specific snapshot
 */
export async function rollbackToSnapshot(snapshotId: string, reason?: string): Promise<boolean> {
  if (!config.enabled) {
    throw new Error('Rollback service is disabled');
  }

  const snapshot = snapshots.get(snapshotId);
  if (!snapshot) {
    throw new Error(`Snapshot ${snapshotId} not found`);
  }

  stats.rollbacksPerformed++;
  stats.lastRollbackTime = Date.now();

  try {
    console.info(
      `🔄 Rolling back to snapshot ${snapshotId}: ${snapshot.description} (${reason || 'Manual rollback'})`
    );

    // Verify snapshot integrity
    const state = config.enableCompression ? decompressState(snapshot.state) : snapshot.state;

    const currentChecksum = calculateChecksum(state);
    if (currentChecksum !== snapshot.checksum) {
      throw new Error('Snapshot integrity check failed');
    }

    // Restore state
    const store = useMultiMapStore.getState();

    // Batch state updates to minimize UI disruption
    const updates = [
      { type: 'maps', data: state.maps },
      { type: 'robots', data: state.robots },
      { type: 'layers', data: state.layers },
      { type: 'assignments', data: state.assignments },
      { type: 'viewports', data: state.viewports },
    ];

    for (const update of updates) {
      switch (update.type) {
        case 'maps':
          // Use store methods to update maps
          for (const [mapId, mapData] of update.data.entries()) {
            const existingMap = store.maps.get(mapId);
            if (existingMap) {
              // Update existing map
              Object.assign(existingMap, mapData);
            } else {
              // Add new map
              store.maps.set(mapId, mapData);
            }
          }
          break;

        case 'robots':
          // Use store methods to update robots
          for (const [robotId, robotData] of update.data.entries()) {
            store.updateRobot(robotId, robotData);
          }
          break;

        case 'layers':
          // Update layers
          store.layers = update.data;
          break;

        case 'assignments':
          // Update assignments
          store.assignments = update.data;
          break;

        case 'viewports':
          // Update viewports
          for (const [mapId, viewport] of update.data.entries()) {
            store.updateViewport(mapId, viewport);
          }
          break;
      }
    }

    stats.rollbackSuccessCount++;
    console.info(`✅ Successfully rolled back to snapshot ${snapshotId}`);
    return true;
  } catch (error) {
    stats.rollbackFailureCount++;
    console.error(`❌ Failed to rollback to snapshot ${snapshotId}:`, error);
    throw new Error(`Rollback failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Start automatic snapshot creation
 */
function startAutoSnapshot(): void {
  if (snapshotTimer) {
    clearInterval(snapshotTimer);
  }

  snapshotTimer = window.setInterval(() => {
    try {
      createSnapshot('Auto snapshot');
    } catch (error) {
      console.error('Auto snapshot creation failed:', error);
    }
  }, config.snapshotInterval);
}

/**
 * Stop automatic snapshot creation
 */
export function stopAutoSnapshot(): void {
  if (snapshotTimer) {
    clearInterval(snapshotTimer);
    snapshotTimer = null;
  }
}

/**
 * Auto rollback on failure with circuit breaker integration
 */
export async function autoRollback(
  failureReason: string,
  maxAttempts: number = 3
): Promise<boolean> {
  if (!config.autoRollbackOnFailure) {
    return false;
  }

  const recentSnapshot = getMostRecentSnapshot();
  if (!recentSnapshot) {
    console.warn('No snapshots available for auto-rollback');
    return false;
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.info(`🔄 Auto-rollback attempt ${attempt}/${maxAttempts} due to: ${failureReason}`);

      const success = await rollbackToSnapshot(
        recentSnapshot.id,
        `Auto-rollback attempt ${attempt}: ${failureReason}`
      );

      if (success) {
        return true;
      }
    } catch (error) {
      console.error(`Auto-rollback attempt ${attempt} failed:`, error);

      if (attempt < maxAttempts) {
        // Wait before retrying with exponential backoff
        await delay(2 ** attempt * 1000);
      }
    }
  }

  console.error(`❌ Auto-rollback failed after ${maxAttempts} attempts`);
  return false;
}

/**
 * Get most recent snapshot
 */
export function getMostRecentSnapshot(): Snapshot | null {
  let mostRecent: Snapshot | null = null;

  for (const snapshot of Array.from(snapshots.values())) {
    if (!mostRecent || snapshot.timestamp > mostRecent.timestamp) {
      mostRecent = snapshot;
    }
  }

  return mostRecent;
}

/**
 * Get all snapshots
 */
export function getAllSnapshots(): Snapshot[] {
  return Array.from(snapshots.values()).sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Delete a snapshot
 */
export function deleteSnapshot(snapshotId: string): boolean {
  const deleted = snapshots.delete(snapshotId);
  if (deleted) {
    console.debug(`🗑️ Deleted snapshot ${snapshotId}`);
  }
  return deleted;
}

/**
 * Clear all snapshots
 */
export function clearSnapshots(): void {
  snapshots.clear();
  console.debug('🗑️ Cleared all snapshots');
}

/**
 * Get rollback statistics
 */
export function getStats(): RollbackStats {
  return { ...stats };
}

/**
 * Update configuration
 */
export function updateConfig(newConfig: Partial<RollbackConfig>): void {
  config = { ...config, ...newConfig };

  if (config.enabled && !snapshotTimer) {
    startAutoSnapshot();
  } else if (!config.enabled && snapshotTimer) {
    stopAutoSnapshot();
  }
}

/**
 * Cleanup resources
 */
export function cleanup(): void {
  stopAutoSnapshot();
  clearSnapshots();
}

// Initialize auto snapshot if enabled
if (config.enabled) {
  startAutoSnapshot();
}

/**
 * Hook for accessing rollback service
 */
export function useRollbackService() {
  return {
    createSnapshot,
    rollbackToSnapshot,
    autoRollback,
    getMostRecentSnapshot,
    getAllSnapshots,
    deleteSnapshot,
    clearSnapshots,
    getStats,
    updateConfig,
  };
}

/**
 * Backward compatibility object
 */
export const rollbackService = {
  getInstance: (initialConfig?: Partial<RollbackConfig>) => {
    if (initialConfig) {
      updateConfig(initialConfig);
    }
    return {
      createSnapshot,
      rollbackToSnapshot,
      autoRollback,
      getMostRecentSnapshot,
      getAllSnapshots,
      deleteSnapshot,
      clearSnapshots,
      getStats,
      updateConfig,
      cleanup,
    };
  },
  reset: cleanup,
};
