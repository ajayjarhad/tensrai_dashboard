/**
 * Multi-Map State Management Store
 * Zustand store for managing multiple maps, robot assignments, and layers
 */

import type { RobotInfo } from '@tensrai/shared';
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { loadMapAssets } from '../../../lib/map';
import type {
  MapAssignment,
  MapRegistrationConfig,
  MapRegistryEntry,
  MapSyncEvent,
  MultiMapActions,
  MultiMapAnalytics,
  MultiMapError,
  MultiMapState,
} from '../types/multi-map';

interface MultiMapStore extends MultiMapState, MultiMapActions {
  getAnalytics: () => MultiMapAnalytics;
  errors: MultiMapError[];
  addError: (error: Omit<MultiMapError, 'timestamp'>) => void;
  clearErrors: () => void;
  recoverFromErrors: () => void;
  events: MapSyncEvent[];
  emitEvent: (event: Omit<MapSyncEvent, 'timestamp'>) => void;
}

const DEFAULT_SETTINGS = {
  maxLoadedMaps: 5,
  autoLoadMaps: true,
  trackRobotPositions: true,
  showInactiveRobots: false,
};

const createMapRegistryEntry = (mapId: string, config: MapRegistrationConfig): MapRegistryEntry => {
  const entry: MapRegistryEntry = {
    mapId,
    name: config.name,
    yamlPath: config.yamlPath,
    data: null,
    metadata: {
      width: 0,
      height: 0,
      resolution: 0.05,
      origin: [0, 0, 0],
      bounds: {
        min: { x: 0, y: 0 },
        max: { x: 0, y: 0 },
      },
    },
    assignedRobots: new Set(),
    loadStatus: config.preload ? 'loading' : 'unloaded',
    loadError: '',
    lastAccessed: new Date(),
    accessCount: 0,
  };

  if (config.description) {
    entry.description = config.description;
  }

  return entry;
};

export const useMultiMapStore = create<MultiMapStore>()(
  subscribeWithSelector((set, get) => {
    const initialState = {
      maps: new Map(),
      assignments: new Map(),
      activeMapId: null,
      focusedRobotId: null,
      layers: new Map(),
      layerOrder: [],
      robots: new Map(),
      robotFrames: new Map(),
      viewports: new Map(),
      settings: DEFAULT_SETTINGS,
      isInitialized: false,
      lastSync: null,
      errors: [],
      events: [],
    };

    return {
      ...initialState,
      registerMap: (mapId, config) => {
        set(state => {
          const newMaps = new Map(state.maps);

          if (newMaps.has(mapId)) {
            console.warn(`Map ${mapId} is already registered`);
            return state;
          }

          const entry = createMapRegistryEntry(mapId, config);
          newMaps.set(mapId, entry);

          const event: MapSyncEvent = {
            type: 'map_registered',
            mapId,
            timestamp: new Date(),
            data: { config },
          };

          return {
            maps: newMaps,
            events: [...state.events, event],
          };
        });

        // Auto-load if enabled and config specifies preload
        const { autoLoadMaps } = get().settings;
        if (autoLoadMaps || config.preload) {
          get().loadMap(mapId);
        }
      },

      unregisterMap: mapId => {
        set(state => {
          const newMaps = new Map(state.maps);
          const map = newMaps.get(mapId);

          if (!map) {
            console.warn(`Map ${mapId} not found for unregistration`);
            return state;
          }

          // Remove robot assignments
          const newAssignments = new Map(state.assignments);
          map.assignedRobots.forEach(robotId => {
            newAssignments.delete(robotId);
          });

          // Remove viewports
          const newViewports = new Map(state.viewports);
          newViewports.delete(mapId);

          // Remove layers
          const newLayers = new Map(state.layers);
          const newLayerOrder = state.layerOrder.filter(layerId => {
            const layer = newLayers.get(layerId);
            return layer?.mapId !== mapId;
          });
          newLayers.forEach((layer, layerId) => {
            if (layer.mapId === mapId) {
              newLayers.delete(layerId);
            }
          });

          newMaps.delete(mapId);

          // Update active map if necessary
          const newActiveMapId = state.activeMapId === mapId ? null : state.activeMapId;

          const event: MapSyncEvent = {
            type: 'map_unregistered',
            mapId,
            timestamp: new Date(),
          };

          return {
            maps: newMaps,
            assignments: newAssignments,
            activeMapId: newActiveMapId,
            layers: newLayers,
            layerOrder: newLayerOrder,
            viewports: newViewports,
            events: [...state.events, event],
          };
        });
      },

      loadMap: async mapId => {
        const map = get().maps.get(mapId);
        if (!map) {
          get().addError({
            type: 'map_load_error',
            mapId,
            message: `Map ${mapId} not found`,
            recoverable: false,
          });
          return;
        }

        if (map.loadStatus === 'loaded') {
          // Update access tracking
          set(state => {
            const newMaps = new Map(state.maps);
            const updatedMap = {
              ...map,
              lastAccessed: new Date(),
              accessCount: map.accessCount + 1,
            };
            newMaps.set(mapId, updatedMap);
            return { maps: newMaps };
          });
          return;
        }

        // Update loading status
        set(state => {
          const newMaps = new Map(state.maps);
          const updatedMap = { ...map, loadStatus: 'loading' as const, loadError: '' };
          newMaps.set(mapId, updatedMap);
          return { maps: newMaps };
        });

        try {
          const mapData = await loadMapAssets({
            yamlPath: map.yamlPath,
            timeout: 30000,
          });

          // Calculate bounds from metadata
          const { width, height, resolution, origin } = mapData.meta;
          const bounds = {
            min: { x: origin[0], y: origin[1] },
            max: {
              x: origin[0] + width * resolution,
              y: origin[1] + height * resolution,
            },
          };

          // Update map with loaded data
          set(state => {
            const newMaps = new Map(state.maps);
            const updatedMap: MapRegistryEntry = {
              ...map,
              data: mapData,
              metadata: {
                width,
                height,
                resolution,
                origin,
                bounds,
              },
              loadStatus: 'loaded',
              lastAccessed: new Date(),
              accessCount: map.accessCount + 1,
            };
            newMaps.set(mapId, updatedMap);

            // Initialize viewport if not exists
            const newViewports = new Map(state.viewports);
            if (!newViewports.has(mapId)) {
              newViewports.set(mapId, {
                mapId,
                center: {
                  x: bounds.min.x + (bounds.max.x - bounds.min.x) / 2,
                  y: bounds.min.y + (bounds.max.y - bounds.min.y) / 2,
                },
                zoom: 1.0,
                rotation: 0,
              });
            }

            const event: MapSyncEvent = {
              type: 'map_loaded',
              mapId,
              timestamp: new Date(),
              data: { bounds },
            };

            return {
              maps: newMaps,
              viewports: newViewports,
              events: [...state.events, event],
            };
          });

          // Evict old maps if we exceed the limit
          const { maxLoadedMaps } = get().settings;
          const loadedMaps = Array.from(get().maps.values())
            .filter(m => m.loadStatus === 'loaded')
            .sort((a, b) => a.lastAccessed.getTime() - b.lastAccessed.getTime());

          if (loadedMaps.length > maxLoadedMaps) {
            const mapsToUnload = loadedMaps.slice(0, loadedMaps.length - maxLoadedMaps);
            mapsToUnload.forEach(mapToUnload => {
              get().unloadMap(mapToUnload.mapId);
            });
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';

          set(state => {
            const newMaps = new Map(state.maps);
            const updatedMap = { ...map, loadStatus: 'error' as const, loadError: errorMessage };
            newMaps.set(mapId, updatedMap);
            return { maps: newMaps };
          });

          get().addError({
            type: 'map_load_error',
            mapId,
            message: errorMessage,
            recoverable: true,
          });
        }
      },

      unloadMap: mapId => {
        set(state => {
          const newMaps = new Map(state.maps);
          const map = newMaps.get(mapId);

          if (!map || map.loadStatus !== 'loaded') {
            return state;
          }

          const updatedMap = {
            ...map,
            data: null,
            loadStatus: 'unloaded' as const,
            loadError: '',
          };
          newMaps.set(mapId, updatedMap);

          const event: MapSyncEvent = {
            type: 'map_unloaded',
            mapId,
            timestamp: new Date(),
          };

          return {
            maps: newMaps,
            events: [...state.events, event],
          };
        });
      },

      // Robot Assignment Actions
      assignRobotToMap: (robotId, mapId, assignedBy = 'system') => {
        set(state => {
          const map = state.maps.get(mapId);
          if (!map) {
            console.error(`Cannot assign robot to unknown map: ${mapId}`);
            return state;
          }

          const newAssignments = new Map(state.assignments);
          const newMaps = new Map(state.maps);

          // Remove any existing assignment
          const existingAssignment = state.assignments.get(robotId);
          if (existingAssignment) {
            const oldMap = state.maps.get(existingAssignment.mapId);
            if (oldMap) {
              const updatedOldMap = {
                ...oldMap,
                assignedRobots: new Set(
                  Array.from(oldMap.assignedRobots).filter(id => id !== robotId)
                ),
              };
              newMaps.set(existingAssignment.mapId, updatedOldMap);
            }
          }

          // Create new assignment
          const assignment: MapAssignment = {
            robotId,
            mapId,
            assignedAt: new Date(),
            assignedBy,
            status: 'active',
          };
          newAssignments.set(robotId, assignment);

          // Update map's robot list
          const updatedMap = {
            ...map,
            assignedRobots: new Set([...Array.from(map.assignedRobots), robotId]),
          };
          newMaps.set(mapId, updatedMap);

          const event: MapSyncEvent = {
            type: 'robot_assigned',
            mapId,
            robotId,
            timestamp: new Date(),
            data: { assignedBy },
          };

          return {
            assignments: newAssignments,
            maps: newMaps,
            events: [...state.events, event],
          };
        });
      },

      unassignRobot: robotId => {
        set(state => {
          const assignment = state.assignments.get(robotId);
          if (!assignment) {
            console.warn(`No assignment found for robot: ${robotId}`);
            return state;
          }

          const newAssignments = new Map(state.assignments);
          newAssignments.delete(robotId);

          const newMaps = new Map(state.maps);
          const map = newMaps.get(assignment.mapId);
          if (map) {
            const updatedMap = {
              ...map,
              assignedRobots: new Set(Array.from(map.assignedRobots).filter(id => id !== robotId)),
            };
            newMaps.set(assignment.mapId, updatedMap);
          }

          const event: MapSyncEvent = {
            type: 'robot_unassigned',
            mapId: assignment.mapId,
            robotId,
            timestamp: new Date(),
          };

          return {
            assignments: newAssignments,
            maps: newMaps,
            events: [...state.events, event],
          };
        });
      },

      transferRobot: (robotId, newMapId) => {
        const assignment = get().assignments.get(robotId);
        if (!assignment) {
          console.warn(`Cannot transfer robot with no assignment: ${robotId}`);
          return;
        }

        get().unassignRobot(robotId);
        get().assignRobotToMap(robotId, newMapId, 'transfer');

        const event: MapSyncEvent = {
          type: 'robot_transferred',
          mapId: newMapId,
          robotId,
          timestamp: new Date(),
          data: { fromMapId: assignment.mapId },
        };

        set(state => ({
          events: [...state.events, event],
        }));
      },

      // Active Map Management
      setActiveMap: mapId => {
        set({ activeMapId: mapId });

        if (mapId) {
          get().loadMap(mapId);
        }
      },

      focusRobot: robotId => {
        const assignment = robotId ? get().assignments.get(robotId) : null;
        const mapId = assignment?.mapId || null;

        set({
          focusedRobotId: robotId,
          activeMapId: mapId,
        });
      },

      // Layer Management
      addLayer: layer => {
        set(state => {
          const newLayers = new Map(state.layers);
          newLayers.set(layer.id, layer);
          return {
            layers: newLayers,
            layerOrder: [...state.layerOrder, layer.id],
          };
        });
      },

      removeLayer: layerId => {
        set(state => ({
          layers: new Map(Array.from(state.layers).filter(([id]) => id !== layerId)),
          layerOrder: state.layerOrder.filter(id => id !== layerId),
        }));
      },

      updateLayer: (layerId, updates) => {
        set(state => {
          const layer = state.layers.get(layerId);
          if (!layer) return state;

          const newLayers = new Map(state.layers);
          newLayers.set(layerId, { ...layer, ...updates });
          return { layers: newLayers };
        });
      },

      reorderLayers: layerIds => {
        set({ layerOrder: layerIds });
      },

      // Robot Updates
      updateRobot: (robotId, updates) => {
        set(state => {
          const newRobots = new Map(state.robots);
          const existingRobot = state.robots.get(robotId);
          const updatedRobot = existingRobot
            ? { ...existingRobot, ...updates }
            : ({ id: robotId, ...updates } as RobotInfo);
          newRobots.set(robotId, updatedRobot);
          return { robots: newRobots };
        });
      },

      updateRobotPose: (robotId, pose) => {
        set(state => {
          const newRobots = new Map(state.robots);
          const robot = newRobots.get(robotId);

          if (robot) {
            const updatedRobot = { ...robot, currentPose: pose, lastUpdate: new Date() };
            newRobots.set(robotId, updatedRobot);
          }

          return { robots: newRobots };
        });
      },

      removeRobot: robotId => {
        get().unassignRobot(robotId);
        set(state => {
          const newRobots = new Map(state.robots);
          newRobots.delete(robotId);
          return { robots: newRobots };
        });
      },

      // Viewport Management
      updateViewport: (mapId, viewport) => {
        set(state => {
          const newViewports = new Map(state.viewports);
          const currentViewport = state.viewports.get(mapId) || {
            mapId,
            center: { x: 0, y: 0 },
            zoom: 1.0,
            rotation: 0,
          };
          newViewports.set(mapId, { ...currentViewport, ...viewport });
          return { viewports: newViewports };
        });
      },

      // Settings
      updateSettings: settings => {
        set(state => ({
          settings: { ...state.settings, ...settings },
        }));
      },

      // Utility Actions
      clearAllMaps: () => {
        set({
          maps: new Map(),
          assignments: new Map(),
          activeMapId: null,
          focusedRobotId: null,
          viewports: new Map(),
          lastSync: new Date(),
        });
      },

      syncAssignments: () => {
        // This would integrate with backend in Phase 3
        set({ lastSync: new Date() });
      },

      // Analytics
      getAnalytics: () => {
        const state = get();
        const maps = Array.from(state.maps.values());
        const robots = Array.from(state.robots.values());

        const mapUtilization = new Map<string, number>();
        maps.forEach(map => {
          mapUtilization.set(map.mapId, map.assignedRobots.size);
        });

        const mostActiveMap = maps.reduce(
          (prev, current) => (current.accessCount > prev.accessCount ? current : prev),
          maps[0]
        );

        const robotStatusCounts = robots.reduce(
          (acc, robot) => {
            acc[robot.status]++;
            return acc;
          },
          { online: 0, offline: 0, error: 0 }
        );

        return {
          totalMaps: maps.length,
          loadedMaps: maps.filter(m => m.loadStatus === 'loaded').length,
          totalRobots: robots.length,
          activeRobots: robots.filter(r => r.status === 'online').length,
          mapUtilization,
          mostActiveMap: mostActiveMap?.mapId,
          robotStatusCounts,
          lastUpdated: new Date(),
        };
      },

      // Error Handling
      addError: error => {
        set(state => ({
          errors: [...state.errors, { ...error, timestamp: new Date() }],
        }));
      },

      clearErrors: () => {
        set({ errors: [] });
      },

      // Event System
      emitEvent: event => {
        set(state => ({
          events: [...state.events, { ...event, timestamp: new Date() }],
        }));
      },

      // Error Recovery
      recoverFromErrors: () => {
        set(state => {
          const { maps, assignments } = state;
          const newMaps = new Map(maps);
          const newAssignments = new Map(assignments);

          // Fix orphaned assignments (robot assigned to non-existent maps)
          assignments.forEach((assignment, robotId) => {
            const map = newMaps.get(assignment.mapId);
            if (map) {
              // Ensure map's robot list includes this robot
              if (!map.assignedRobots.has(robotId)) {
                const updatedMap = {
                  ...map,
                  assignedRobots: new Set([...Array.from(map.assignedRobots), robotId]),
                };
                newMaps.set(assignment.mapId, updatedMap);
              }
            } else {
              newAssignments.delete(robotId);
              console.warn(
                `Removed orphaned assignment for robot ${robotId} to unknown map ${assignment.mapId}`
              );
            }
          });

          // Fix maps with missing assignments in robot list
          newMaps.forEach((map, mapId) => {
            const mapRobots = Array.from(map.assignedRobots);
            const actualAssignments = Array.from(newAssignments.values())
              .filter(a => a.mapId === mapId && a.status === 'active')
              .map(a => a.robotId);

            const missingInAssignments = mapRobots.filter(id => !actualAssignments.includes(id));
            const missingInMap = actualAssignments.filter(id => !mapRobots.includes(id));

            if (missingInAssignments.length > 0 || missingInMap.length > 0) {
              const updatedMap = {
                ...map,
                assignedRobots: new Set(actualAssignments),
              };
              newMaps.set(mapId, updatedMap);
            }
          });

          return {
            maps: newMaps,
            assignments: newAssignments,
            errors: [], // Clear errors after recovery
            lastSync: new Date(),
          };
        });
      },
    };
  })
);

// Selector hooks for common use cases
export const useMaps = () => useMultiMapStore(state => state.maps);
export const useActiveMap = () =>
  useMultiMapStore(state => (state.activeMapId ? state.maps.get(state.activeMapId) : null));
export const useRobotAssignments = () => useMultiMapStore(state => state.assignments);
export const useMapAnalytics = () => useMultiMapStore(state => state.getAnalytics());
export const useMapLayers = () =>
  useMultiMapStore(state => ({
    layers: state.layers,
    layerOrder: state.layerOrder,
  }));
