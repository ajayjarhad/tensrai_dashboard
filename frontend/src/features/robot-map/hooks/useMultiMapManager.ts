/**
 * Multi-Map Manager Hook
 * High-level hook for managing multi-map operations and robot assignments
 */

import type { ProcessedMapData, RobotInfo } from '@tensrai/shared';
import { useCallback, useEffect, useMemo } from 'react';
import {
  useActiveMap,
  useMaps,
  useMultiMapStore,
  useRobotAssignments,
} from '../stores/useMultiMapStore';
import type {
  MapRegistrationConfig,
  MultiMapViewportConfig,
  ViewportState,
} from '../types/multi-map';

export interface UseMultiMapManagerOptions {
  maxLoadedMaps?: number;
  autoLoadMaps?: boolean;
  trackRobotPositions?: boolean;
}

export interface UseMultiMapManagerReturn {
  // Map Management
  registerMap: (id: string, config: MapRegistrationConfig) => void;
  unregisterMap: (id: string) => void;
  loadMap: (id: string) => Promise<void>;
  unloadMap: (id: string) => void;

  // Active Map Control
  activeMapId: string | null;
  activeMap: ProcessedMapData | null;
  setActiveMap: (id: string | null) => void;
  focusRobot: (robotId: string | null) => void;

  // Robot Assignment
  assignRobotToMap: (robotId: string, mapId: string) => void;
  unassignRobot: (robotId: string) => void;
  transferRobot: (robotId: string, targetMapId: string) => void;
  getRobotsOnMap: (mapId: string) => string[];

  // Map Information
  maps: Map<string, any>;
  mapIds: string[];
  loadedMapIds: string[];
  mapLoadStatuses: Map<string, 'unloaded' | 'loading' | 'loaded' | 'error'>;

  // Robot Information
  assignments: Map<string, any>;
  robotsOnActiveMap: string[];
  allRobots: Map<string, RobotInfo>;

  // Viewport Management
  viewportConfig: MultiMapViewportConfig;
  updateViewportConfig: (config: Partial<MultiMapViewportConfig>) => void;
}

export function useMultiMapManager(
  options: UseMultiMapManagerOptions = {}
): UseMultiMapManagerReturn {
  // Initialize the store if needed
  const isInitialized = useMultiMapStore(state => state.isInitialized);

  useEffect(() => {
    if (!isInitialized) {
      useMultiMapStore.setState({ isInitialized: true });
    }
  }, [isInitialized]);
  const {
    registerMap: registerMapStore,
    unregisterMap: unregisterMapStore,
    loadMap: loadMapStore,
    unloadMap: unloadMapStore,
    assignRobotToMap: assignRobotStore,
    unassignRobot: unassignRobotStore,
    transferRobot: transferRobotStore,
    setActiveMap: setActiveMapStore,
    focusRobot: focusRobotStore,
    updateSettings,
  } = useMultiMapStore();

  const maps = useMaps();
  const activeMapEntry = useActiveMap();
  const assignments = useRobotAssignments();

  // Update settings when options change
  useEffect(() => {
    if (Object.keys(options).length > 0) {
      updateSettings(options);
    }
  }, [options, updateSettings]);

  // Map Management
  const registerMap = useCallback(
    (id: string, config: MapRegistrationConfig) => {
      registerMapStore(id, config);
    },
    [registerMapStore]
  );

  const unregisterMap = useCallback(
    (id: string) => {
      unregisterMapStore(id);
    },
    [unregisterMapStore]
  );

  const loadMap = useCallback(
    async (id: string) => {
      await loadMapStore(id);
    },
    [loadMapStore]
  );

  const unloadMap = useCallback(
    (id: string) => {
      unloadMapStore(id);
    },
    [unloadMapStore]
  );

  // Robot Assignment
  const assignRobotToMap = useCallback(
    (robotId: string, mapId: string) => {
      assignRobotStore(robotId, mapId);
    },
    [assignRobotStore]
  );

  const unassignRobot = useCallback(
    (robotId: string) => {
      unassignRobotStore(robotId);
    },
    [unassignRobotStore]
  );

  const transferRobot = useCallback(
    (robotId: string, targetMapId: string) => {
      transferRobotStore(robotId, targetMapId);
    },
    [transferRobotStore]
  );

  const focusRobot = useCallback(
    (robotId: string | null) => {
      focusRobotStore(robotId);
    },
    [focusRobotStore]
  );

  // Derived State
  const mapIds = useMemo(() => Array.from(maps.keys()), [maps]);
  const loadedMapIds = useMemo(
    () =>
      Array.from(maps.values())
        .filter(map => map.loadStatus === 'loaded')
        .map(map => map.mapId),
    [maps]
  );

  const mapLoadStatuses = useMemo(() => {
    const statuses = new Map<string, 'unloaded' | 'loading' | 'loaded' | 'error'>();
    maps.forEach((map, id) => {
      statuses.set(id, map.loadStatus);
    });
    return statuses;
  }, [maps]);

  const robotsOnActiveMap = useMemo(() => {
    if (!activeMapEntry) return [];
    return Array.from(activeMapEntry.assignedRobots);
  }, [activeMapEntry]);

  const getRobotsOnMap = useCallback(
    (mapId: string): string[] => {
      const map = maps.get(mapId);
      return map ? Array.from(map.assignedRobots) : [];
    },
    [maps]
  );

  const allRobots = useMultiMapStore(state => state.robots);

  const activeMapId = useMultiMapStore(state => state.activeMapId);
  const activeMap = useMemo(() => activeMapEntry?.data || null, [activeMapEntry]);

  const viewportConfig = useMemo(
    () => ({
      mode: 'single' as const,
      layout: 'horizontal' as const,
      primaryMapId: activeMapId || undefined,
      syncZoom: true,
      syncPan: true,
      showCrosshairs: false,
    }),
    [activeMapId]
  );

  const updateViewportConfig = useCallback((config: Partial<MultiMapViewportConfig>) => {
    // This would update the viewport configuration
    // Implementation depends on how we structure the viewport component
    console.log('Updating viewport config:', config);
  }, []);

  return {
    // Map Management
    registerMap,
    unregisterMap,
    loadMap,
    unloadMap,

    // Active Map Control
    activeMapId,
    activeMap,
    setActiveMap: setActiveMapStore,
    focusRobot,

    // Robot Assignment
    assignRobotToMap,
    unassignRobot,
    transferRobot,
    getRobotsOnMap,

    // Map Information
    maps,
    mapIds,
    loadedMapIds,
    mapLoadStatuses,

    // Robot Information
    assignments,
    robotsOnActiveMap,
    allRobots,

    // Viewport Management
    viewportConfig,
    updateViewportConfig,
  };
}

/**
 * Hook for managing a specific map
 */
export function useMapManager(mapId: string) {
  const {
    maps,
    loadMap,
    unloadMap,
    assignRobotToMap,
    unassignRobot: unassignRobotFromStore,
    updateViewport,
  } = useMultiMapStore();

  const map = useMemo(() => maps.get(mapId), [maps, mapId]);

  const isLoaded = map?.loadStatus === 'loaded';
  const isLoading = map?.loadStatus === 'loading';
  const hasError = map?.loadStatus === 'error';
  const error = map?.loadError;

  const assignedRobots = useMemo(() => {
    return map ? Array.from(map.assignedRobots) : [];
  }, [map]);

  const load = useCallback(() => {
    if (!isLoaded && !isLoading) {
      loadMap(mapId);
    }
  }, [loadMap, mapId, isLoaded, isLoading]);

  const unload = useCallback(() => {
    if (isLoaded) {
      unloadMap(mapId);
    }
  }, [unloadMap, mapId, isLoaded]);

  const assignRobot = useCallback(
    (robotId: string) => {
      assignRobotToMap(robotId, mapId);
    },
    [assignRobotToMap, mapId]
  );

  return {
    map,
    isLoaded,
    isLoading,
    hasError,
    error,
    assignedRobots,
    load,
    unload,
    assignRobot,
    unassignRobot: unassignRobotFromStore,
    updateViewport: (viewport: Partial<ViewportState>) => updateViewport(mapId, viewport),
  };
}

// Re-export useRobotAssignments for convenience
export { useRobotAssignments } from '../stores/useMultiMapStore';
