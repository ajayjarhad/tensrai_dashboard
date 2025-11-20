/**
 * Multi-Map View Component
 * High-level component that combines multi-map management with rendering
 */

import type { WorldPoint } from '@tensrai/shared';
import { useCallback, useEffect, useState } from 'react';
import { useMultiMapManager } from '../hooks/useMultiMapManager';
import type { MapRegistrationConfig, MultiMapViewportConfig } from '../types/multi-map';
import { MapErrorBoundary } from './MapErrorBoundary';
import { MultiMapStage } from './MultiMapStage';

interface MultiMapViewProps {
  maps: MapRegistrationConfig[] | readonly MapRegistrationConfig[];
  initialActiveMap?: string;
  width?: number | string;
  height?: number | string;
  className?: string;
  showDebugOverlay?: boolean;
  enableLayerControls?: boolean;
  enableMapSwitching?: boolean;
  viewportConfig?: Partial<MultiMapViewportConfig>;
  onMapLoad?: (mapId: string) => void;
  onMapError?: (mapId: string, error: string) => void;
  onCoordinateChange?: (worldCoords: WorldPoint | null, mapId: string) => void;
}

export function MultiMapView({
  maps: mapConfigs,
  initialActiveMap,
  width = '100%',
  height = '100%',
  className,
  showDebugOverlay = false,
  enableLayerControls = true,
  enableMapSwitching = true,
  onMapLoad,
  onMapError,
  onCoordinateChange,
}: MultiMapViewProps) {
  const [isInitialized, setIsInitialized] = useState(false);

  const {
    registerMap,
    unregisterMap,
    loadMap,
    activeMapId,
    setActiveMap,
    robotsOnActiveMap,
    mapIds,
    mapLoadStatuses,
  } = useMultiMapManager({
    maxLoadedMaps: 5,
    autoLoadMaps: true,
  });

  useEffect(() => {
    if (isInitialized) return;

    mapConfigs.forEach((config, _index) => {
      const mapId = config.name.toLowerCase().replace(/\s+/g, '-');
      registerMap(mapId, config);
    });

    if (initialActiveMap) {
      setActiveMap(initialActiveMap);
    } else if (mapConfigs.length > 0) {
      const firstMapId = mapConfigs[0].name.toLowerCase().replace(/\s+/g, '-');
      setActiveMap(firstMapId);
    }

    setIsInitialized(true);
  }, [mapConfigs, initialActiveMap, registerMap, setActiveMap, isInitialized]);

  useEffect(() => {
    if (!isInitialized) return;

    mapConfigs.forEach(config => {
      const mapId = config.name.toLowerCase().replace(/\s+/g, '-');
      if (config.preload && mapLoadStatuses.get(mapId) === 'unloaded') {
        loadMap(mapId)
          .then(() => onMapLoad?.(mapId))
          .catch(error => onMapError?.(mapId, error.message));
      }
    });
  }, [mapConfigs, mapLoadStatuses, loadMap, onMapLoad, onMapError, isInitialized]);

  useEffect(() => {
    return () => {
      if (isInitialized) {
        mapConfigs.forEach(config => {
          const mapId = config.name.toLowerCase().replace(/\s+/g, '-');
          unregisterMap(mapId);
        });
      }
    };
  }, [mapConfigs, unregisterMap, isInitialized]);

  const handleCoordinateChange = useCallback(
    (worldCoords: WorldPoint | null, mapId: string) => {
      onCoordinateChange?.(worldCoords, mapId);
    },
    [onCoordinateChange]
  );

  if (!isInitialized) {
    return (
      <div
        className={`flex items-center justify-center bg-gray-100 ${className || ''}`}
        style={{ width, height }}
      >
        <div className="text-center">
          <div className="text-gray-500 mb-2">Initializing multi-map system...</div>
        </div>
      </div>
    );
  }

  if (mapConfigs.length === 0) {
    return (
      <div
        className={`flex items-center justify-center bg-gray-100 ${className || ''}`}
        style={{ width, height }}
      >
        <div className="text-center">
          <div className="text-gray-500 mb-2">No maps configured</div>
          <div className="text-sm text-gray-400">Add maps to the configuration to get started</div>
        </div>
      </div>
    );
  }

  if (activeMapId && !mapIds.includes(activeMapId)) {
    return (
      <div
        className={`flex items-center justify-center bg-gray-100 ${className || ''}`}
        style={{ width, height }}
      >
        <div className="text-center">
          <div className="text-red-500 mb-2">Active map not found</div>
          <div className="text-sm text-gray-400">Map ID: {activeMapId}</div>
        </div>
      </div>
    );
  }

  const activeMapStatus = activeMapId ? mapLoadStatuses.get(activeMapId) : 'unloaded';
  if (activeMapStatus === 'loading') {
    return (
      <div
        className={`flex items-center justify-center bg-gray-100 ${className || ''}`}
        style={{ width, height }}
      >
        <div className="text-center">
          <div className="text-gray-500 mb-2">Loading map...</div>
          <div className="text-sm text-gray-400">Please wait while we load the map data</div>
        </div>
      </div>
    );
  }

  if (activeMapStatus === 'error') {
    return (
      <div
        className={`flex items-center justify-center bg-gray-100 ${className || ''}`}
        style={{ width, height }}
      >
        <div className="text-center">
          <div className="text-red-500 mb-2">Failed to load map</div>
          <div className="text-sm text-gray-400 mb-4">
            The selected map could not be loaded. Please check the configuration.
          </div>
          <button
            type="button"
            onClick={() => activeMapId && loadMap(activeMapId)}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors text-sm"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!activeMapId) {
    return (
      <div
        className={`flex items-center justify-center bg-gray-100 ${className || ''}`}
        style={{ width, height }}
      >
        <div className="text-center">
          <div className="text-gray-500 mb-2">No active map selected</div>
          <div className="text-sm text-gray-400">Select a map from the switcher to get started</div>
        </div>
      </div>
    );
  }

  return (
    <MapErrorBoundary>
      <div className={`relative ${className || ''}`} style={{ width, height }}>
        <div className="absolute top-2 left-2 bg-black bg-opacity-50 text-white px-3 py-1 rounded text-xs">
          {activeMapId && `${activeMapId} (${robotsOnActiveMap.length} robots)`}
        </div>

        <MultiMapStage
          width={width}
          height={height}
          showDebugOverlay={showDebugOverlay}
          enableLayerControls={enableLayerControls}
          enableMapSwitching={enableMapSwitching}
          onCoordinateChange={handleCoordinateChange}
        />
      </div>
    </MapErrorBoundary>
  );
}

/**
 * Preset multi-map configurations for common scenarios
 */

export const MULTI_MAP_PRESETS = {
  SINGLE_MAP: (mapConfig: MapRegistrationConfig) => [mapConfig],

  TWO_ROBOT_FACILITY: [
    {
      name: 'Main Facility Map',
      yamlPath: '/maps/facility_main.yaml',
      description: 'Main facility floor plan',
      preload: true,
    },
    {
      name: 'Storage Area Map',
      yamlPath: '/maps/facility_storage.yaml',
      description: 'Storage and warehouse area',
      preload: false,
    },
  ],

  FOUR_ROBOT_COMPLEX: [
    {
      name: 'Zone Alpha',
      yamlPath: '/maps/zone_alpha.yaml',
      description: 'Alpha zone - robots 1 & 2',
      preload: true,
    },
    {
      name: 'Zone Beta',
      yamlPath: '/maps/zone_beta.yaml',
      description: 'Beta zone - robots 3 & 4',
      preload: true,
    },
  ],

  MULTI_FLOOR_FACILITY: [
    {
      name: 'Ground Floor',
      yamlPath: '/maps/floor_ground.yaml',
      description: 'Ground level operations',
      preload: true,
    },
    {
      name: 'First Floor',
      yamlPath: '/maps/floor_first.yaml',
      description: 'First level operations',
      preload: false,
    },
    {
      name: 'Second Floor',
      yamlPath: '/maps/floor_second.yaml',
      description: 'Second level operations',
      preload: false,
    },
  ],
} as const;
