/**
 * Map Synchronization Utilities
 * Handles synchronization between maps, robot assignments, and data consistency
 */

import { useMultiMapStore } from '../stores/useMultiMapStore';
import type { MapSyncEvent } from '../types/multi-map';

let syncHistory: MapSyncEvent[] = [];
const eventListeners = new Map<string, ((event: MapSyncEvent) => void)[]>();
let syncInterval: number | null = null;

/**
 * Handle robot assigned event
 */
function handleRobotAssigned(event: MapSyncEvent): void {
  if (event.mapId && event.robotId) {
    const state = useMultiMapStore.getState();
    const map = state.maps.get(event.mapId);
    if (map && !map.assignedRobots.has(event.robotId)) {
      const updatedMap = {
        ...map,
        assignedRobots: new Set([...Array.from(map.assignedRobots), event.robotId]),
      };
      const newMaps = new Map(state.maps);
      newMaps.set(event.mapId, updatedMap);
      useMultiMapStore.setState({ maps: newMaps });
    }
  }
}

/**
 * Handle robot unassigned event
 */
function handleRobotUnassigned(event: MapSyncEvent): void {
  if (event.mapId && event.robotId) {
    const state = useMultiMapStore.getState();
    const map = state.maps.get(event.mapId);
    if (map?.assignedRobots.has(event.robotId)) {
      const updatedMap = {
        ...map,
        assignedRobots: new Set(Array.from(map.assignedRobots).filter(id => id !== event.robotId)),
      };
      const newMaps = new Map(state.maps);
      newMaps.set(event.mapId, updatedMap);
      useMultiMapStore.setState({ maps: newMaps });
    }
  }
}

/**
 * Handle map unregistered event
 */
function handleMapUnregistered(event: MapSyncEvent): void {
  const state = useMultiMapStore.getState();
  const assignmentsToClean = Array.from(state.assignments.entries()).filter(
    ([_, assignment]) => assignment.mapId === event.mapId
  );

  if (assignmentsToClean.length > 0) {
    const newAssignments = new Map(state.assignments);
    assignmentsToClean.forEach(([robotId]) => {
      newAssignments.delete(robotId);
    });
    useMultiMapStore.setState({ assignments: newAssignments });
  }
}

/**
 * Emit custom sync events
 */
function emitSyncEvent(event: Omit<MapSyncEvent, 'timestamp'>): void {
  const fullEvent: MapSyncEvent = {
    ...event,
    timestamp: new Date(),
  };

  const state = useMultiMapStore.getState();
  useMultiMapStore.setState({
    events: [...state.events, fullEvent],
  });

  handleSyncEvent(fullEvent);
}

/**
 * Perform automatic corrections based on sync events
 */
function performAutoCorrections(event: MapSyncEvent): void {
  switch (event.type) {
    case 'robot_assigned':
      handleRobotAssigned(event);
      break;

    case 'robot_unassigned':
      handleRobotUnassigned(event);
      break;

    case 'map_unregistered':
      handleMapUnregistered(event);
      break;
  }
}

/**
 * Handle sync events and maintain history
 */
function handleSyncEvent(event: MapSyncEvent): void {
  // Add to history
  syncHistory.push(event);

  // Keep only last 100 events
  if (syncHistory.length > 100) {
    syncHistory = syncHistory.slice(-100);
  }

  // Notify listeners
  const listeners = eventListeners.get(event.type) || [];
  listeners.forEach(listener => {
    try {
      listener(event);
    } catch (error) {
      console.error('Error in sync event listener:', error);
    }
  });

  // Perform automatic corrections for certain events
  performAutoCorrections(event);
}

/**
 * Initialize internal sync listeners
 */
function initializeSyncListeners(): void {
  // Listen to store changes
  useMultiMapStore.subscribe(
    state => state.events,
    events => {
      const latestEvent = events[events.length - 1];
      if (latestEvent) {
        handleSyncEvent(latestEvent);
      }
    }
  );
}

/**
 * Perform consistency check across maps and assignments
 */
function performConsistencyCheck(): void {
  try {
    const state = useMultiMapStore.getState();
    const issues: string[] = [];

    // Check for orphaned robot assignments
    state.assignments.forEach((assignment, robotId) => {
      const map = state.maps.get(assignment.mapId);
      if (!map) {
        issues.push(`Robot ${robotId} assigned to unknown map ${assignment.mapId}`);
      } else if (!map.assignedRobots.has(robotId)) {
        issues.push(
          `Inconsistent assignment: robot ${robotId} not in map ${assignment.mapId} robot list`
        );
      }
    });

    // Check for map inconsistencies
    state.maps.forEach((map, mapId) => {
      // Check robots assigned to map vs map's robot list
      const assignedRobots = Array.from(state.assignments.values())
        .filter(a => a.mapId === mapId && a.status === 'active')
        .map(a => a.robotId);

      const mapRobots = Array.from(map.assignedRobots);
      const missingInAssignments = mapRobots.filter(id => !assignedRobots.includes(id));
      const missingInMap = assignedRobots.filter(id => !mapRobots.includes(id));

      if (missingInAssignments.length > 0) {
        issues.push(
          `Map ${mapId} has robots in robot list but not in assignments: ${missingInAssignments.join(', ')}`
        );
      }
      if (missingInMap.length > 0) {
        issues.push(
          `Map ${mapId} has assignments but missing robots in list: ${missingInMap.join(', ')}`
        );
      }

      // Check loaded maps vs memory limits
      const { maxLoadedMaps } = state.settings;
      const loadedMaps = Array.from(state.maps.values()).filter(m => m.loadStatus === 'loaded');

      if (loadedMaps.length > maxLoadedMaps) {
        issues.push(`Too many loaded maps: ${loadedMaps.length} > ${maxLoadedMaps}`);
      }
    });

    // Log issues and create sync events
    if (issues.length > 0) {
      console.warn('Map synchronization issues detected:', issues);
      emitSyncEvent({
        type: 'pose_updated', // Use existing event type instead of sync_error
        data: { issues },
      });
    }

    // Update last sync time
    useMultiMapStore.setState({ lastSync: new Date() });
  } catch (error) {
    console.error('Error during consistency check:', error);
    emitSyncEvent({
      type: 'pose_updated',
      data: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
  }
}

/**
 * Initialize automatic synchronization monitoring
 */
export function startSyncMonitoring(intervalMs: number = 5000): void {
  if (syncInterval) {
    clearInterval(syncInterval);
  }

  syncInterval = window.setInterval(() => {
    performConsistencyCheck();
  }, intervalMs);
}

/**
 * Stop automatic synchronization monitoring
 */
export function stopSyncMonitoring(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

/**
 * Register event listener for specific event types
 */
export function addEventListener(eventType: string, listener: (event: MapSyncEvent) => void): void {
  if (!eventListeners.has(eventType)) {
    eventListeners.set(eventType, []);
  }
  eventListeners.get(eventType)?.push(listener);
}

/**
 * Remove event listener
 */
export function removeEventListener(
  eventType: string,
  listener: (event: MapSyncEvent) => void
): void {
  const listeners = eventListeners.get(eventType);
  if (listeners) {
    const index = listeners.indexOf(listener);
    if (index !== -1) {
      listeners.splice(index, 1);
    }
  }
}

/**
 * Get synchronization analytics
 */
export function getSyncAnalytics(): {
  totalEvents: number;
  eventsByType: Map<string, number>;
  recentEvents: MapSyncEvent[];
  lastSync: Date | null;
  issues: string[];
} {
  const eventsByType = new Map<string, number>();
  syncHistory.forEach(event => {
    eventsByType.set(event.type, (eventsByType.get(event.type) || 0) + 1);
  });

  return {
    totalEvents: syncHistory.length,
    eventsByType,
    recentEvents: syncHistory.slice(-10),
    lastSync: useMultiMapStore.getState().lastSync,
    issues: [],
  };
}

/**
 * Force synchronization of assignments and maps
 */
export function forceSync(): void {
  const state = useMultiMapStore.getState();
  const newMaps = new Map(state.maps);
  const newAssignments = new Map(state.assignments);

  // Rebuild map robot lists from assignments
  newMaps.forEach((map, mapId) => {
    const assignedRobots = Array.from(newAssignments.values())
      .filter(assignment => assignment.mapId === mapId && assignment.status === 'active')
      .map(assignment => assignment.robotId);

    const updatedMap = {
      ...map,
      assignedRobots: new Set(assignedRobots),
    };
    newMaps.set(mapId, updatedMap);
  });

  // Rebuild assignment references
  newAssignments.forEach((assignment, robotId) => {
    const map = newMaps.get(assignment.mapId);
    if (map && !map.assignedRobots.has(robotId)) {
      newAssignments.delete(robotId);
    }
  });

  useMultiMapStore.setState({
    maps: newMaps,
    assignments: newAssignments,
    lastSync: new Date(),
  });

  emitSyncEvent({
    type: 'pose_updated',
    data: { action: 'force_sync', corrected: true },
  });
}

/**
 * Clean up resources
 */
export function cleanup(): void {
  stopSyncMonitoring();
  eventListeners.clear();
  syncHistory = [];
}

// Initialize listeners
initializeSyncListeners();

/**
 * Hook for accessing synchronization functionality
 */
export function useMapSynchronization() {
  return {
    addEventListener,
    removeEventListener,
    getAnalytics: getSyncAnalytics,
    forceSync,
    startMonitoring: startSyncMonitoring,
    stopMonitoring: stopSyncMonitoring,
  };
}

export const syncManager = {
  getInstance: () => ({
    addEventListener,
    removeEventListener,
    getSyncAnalytics,
    forceSync,
    startSyncMonitoring,
    stopSyncMonitoring,
    cleanup,
  }),
  cleanup,
};
