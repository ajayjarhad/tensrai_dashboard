/**
 * Multi-Map System Example
 * Demonstrates the complete multi-map architecture with robot assignments
 */

import type { WorldPoint } from '@tensrai/shared';
import { useEffect, useState } from 'react';
import { MULTI_MAP_PRESETS, MultiMapView } from '../components/MultiMapView';
import { useMultiMapManager } from '../hooks/useMultiMapManager';
import type { MapRegistrationConfig } from '../types/multi-map';
import { useMapSynchronization } from '../utils/mapSynchronization';

/**
 * Example Multi-Map Dashboard
 * Shows how to set up and use the multi-map system
 */
export function MultiMapExample() {
  const [selectedRobotIds, setSelectedRobotIds] = useState<string[]>([]);
  const [currentCoords, setCurrentCoords] = useState<WorldPoint | null>(null);

  const {
    registerMap,
    assignRobotToMap,
    activeMapId,
    setActiveMap,
    robotsOnActiveMap,
    mapIds,
    mapLoadStatuses,
    maps,
    getRobotsOnMap,
    assignments,
  } = useMultiMapManager({
    maxLoadedMaps: 3,
    autoLoadMaps: true,
  });

  const { getAnalytics, forceSync, startMonitoring } = useMapSynchronization();

  // Initialize example maps
  useEffect(() => {
    // Register example maps (simulating your use case: robots 1&2 → zone-alpha, robots 3&4 → zone-beta)
    const exampleMaps = [
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
    ] as MapRegistrationConfig[];

    exampleMaps.forEach(config => {
      const mapId = config.name.toLowerCase().replace(/\s+/g, '-');
      registerMap(mapId, config);
    });

    // Assign robots to maps (simulating your requirement)
    // Assign robots to maps (simulating your requirement)
    assignRobotToMap('robot-1', 'zone-alpha');
    assignRobotToMap('robot-2', 'zone-alpha');
    assignRobotToMap('robot-3', 'zone-beta');
    assignRobotToMap('robot-4', 'zone-beta');

    // Set initial active map
    // Set initial active map
    setActiveMap('zone-alpha');

    // Start sync monitoring
    startMonitoring(5000);
  }, [registerMap, assignRobotToMap, setActiveMap, startMonitoring]);

  const handleCoordinateChange = (coords: WorldPoint | null, _mapId: string) => {
    setCurrentCoords(coords);
  };

  const handleMapSwitch = (mapId: string) => {
    setActiveMap(mapId);
  };

  const analytics = getAnalytics();

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200 p-4">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-2xl font-bold text-gray-900">Multi-Map Robot Dashboard</h1>
          <p className="text-gray-600">
            Zone Alpha: Robots 1&2 | Zone Beta: Robots 3&4 | Active:{' '}
            {activeMapId ? maps.get(activeMapId)?.name : 'None'}
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex">
        {/* Sidebar */}
        <div className="w-80 bg-white shadow-lg p-4 space-y-6 overflow-y-auto">
          {/* Map Status */}
          <div>
            <h3 className="text-lg font-semibold mb-3">Map Status</h3>
            <div className="space-y-2">
              {mapIds.map(mapId => {
                const status = mapLoadStatuses.get(mapId);
                const robots = getRobotsOnMap(mapId);
                const isActive = mapId === activeMapId;

                return (
                  <button
                    key={mapId}
                    type="button"
                    className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                      isActive
                        ? 'bg-blue-50 border-blue-300'
                        : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                    } w-full text-left`}
                    onClick={() => handleMapSwitch(mapId)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{mapId.replace('-', ' ').toUpperCase()}</span>
                      <span
                        className={`text-xs px-2 py-1 rounded ${
                          status === 'loaded'
                            ? 'bg-green-100 text-green-800'
                            : status === 'loading'
                              ? 'bg-yellow-100 text-yellow-800'
                              : status === 'error'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {status || 'unknown'}
                      </span>
                    </div>
                    <div className="text-sm text-gray-600 mt-1">
                      {robots.length} robot{robots.length !== 1 ? 's' : ''}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Robot Assignment */}
          <div>
            <h3 className="text-lg font-semibold mb-3">Robot Assignments</h3>
            <div className="space-y-2">
              {['robot-1', 'robot-2', 'robot-3', 'robot-4'].map(robotId => {
                const assignedMap = assignments.get(robotId)?.mapId;
                const isActive = selectedRobotIds.includes(robotId);

                return (
                  <button
                    key={robotId}
                    type="button"
                    className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                      isActive
                        ? 'bg-green-50 border-green-300'
                        : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                    } w-full text-left`}
                    onClick={() => {
                      if (isActive) {
                        setSelectedRobotIds(selectedRobotIds.filter(id => id !== robotId));
                      } else {
                        setSelectedRobotIds([...selectedRobotIds, robotId]);
                      }
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{robotId.toUpperCase()}</span>
                      {assignedMap && (
                        <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                          {assignedMap.replace('-', ' ').toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-600 mt-1">Status: Online</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Coordinate Display */}
          {currentCoords && (
            <div>
              <h3 className="text-lg font-semibold mb-3">Current Position</h3>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-sm">
                  <div>X: {currentCoords.x.toFixed(3)} m</div>
                  <div>Y: {currentCoords.y.toFixed(3)} m</div>
                  <div>Map: {activeMapId?.toUpperCase()}</div>
                </div>
              </div>
            </div>
          )}

          {/* Sync Info */}
          <div>
            <h3 className="text-lg font-semibold mb-3">System Info</h3>
            <div className="bg-gray-50 rounded-lg p-3 text-sm">
              <div>Total Maps: {mapIds.length}</div>
              <div>
                Loaded Maps:{' '}
                {Array.from(mapLoadStatuses.values()).filter(s => s === 'loaded').length}
              </div>
              <div>Total Events: {analytics.totalEvents}</div>
              <div>Last Sync: {analytics.lastSync?.toLocaleTimeString() || 'Never'}</div>
              <button
                type="button"
                onClick={forceSync}
                className="mt-2 px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
              >
                Force Sync
              </button>
            </div>
          </div>
        </div>

        {/* Map View */}
        <div className="flex-1 p-4">
          <MultiMapView
            maps={MULTI_MAP_PRESETS.FOUR_ROBOT_COMPLEX}
            initialActiveMap="zone-alpha"
            showDebugOverlay={true}
            enableLayerControls={true}
            enableMapSwitching={true}
            onCoordinateChange={handleCoordinateChange}
            className="h-full rounded-lg shadow-lg"
          />
        </div>
      </div>

      {/* Footer */}
      <div className="bg-white border-t border-gray-200 p-3">
        <div className="max-w-7xl mx-auto text-center text-sm text-gray-600">
          Multi-Map System • {selectedRobotIds.length} robots selected •{robotsOnActiveMap.length}{' '}
          robots on {activeMapId?.toUpperCase() || 'No Map'}
        </div>
      </div>
    </div>
  );
}

/**
 * Preset configurations for common multi-map scenarios
 */
export const EXAMPLE_PRESETS = {
  // Your specific use case: 4 robots, 2 maps
  FOUR_ROBOT_TWO_MAPS: {
    name: '4 Robots, 2 Maps',
    description: 'Robots 1&2 → Zone Alpha, Robots 3&4 → Zone Beta',
    maps: [
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
    assignments: [
      { robotId: 'robot-1', mapId: 'zone-alpha' },
      { robotId: 'robot-2', mapId: 'zone-alpha' },
      { robotId: 'robot-3', mapId: 'zone-beta' },
      { robotId: 'robot-4', mapId: 'zone-beta' },
    ],
  },

  // Large facility scenario
  LARGE_FACILITY: {
    name: 'Large Facility',
    description: 'Multiple zones with robot teams',
    maps: [
      { name: 'Receiving', yamlPath: '/maps/receiving.yaml', preload: true },
      { name: 'Storage A', yamlPath: '/maps/storage_a.yaml', preload: true },
      { name: 'Storage B', yamlPath: '/maps/storage_b.yaml', preload: false },
      { name: 'Shipping', yamlPath: '/maps/shipping.yaml', preload: true },
    ],
    assignments: [
      { robotId: 'forklift-1', mapId: 'receiving' },
      { robotId: 'forklift-2', mapId: 'receiving' },
      { robotId: 'robot-3', mapId: 'storage-a' },
      { robotId: 'robot-4', mapId: 'storage-a' },
      { robotId: 'robot-5', mapId: 'storage-b' },
      { robotId: 'robot-6', mapId: 'shipping' },
      { robotId: 'robot-7', mapId: 'shipping' },
    ],
  },
} as const;

/**
 * Hook for using preset configurations
 */
export function useMultiMapPreset(preset: keyof typeof EXAMPLE_PRESETS) {
  const config = EXAMPLE_PRESETS[preset];
  const { registerMap, assignRobotToMap, setActiveMap } = useMultiMapManager();

  const applyPreset = () => {
    // Register all maps
    config.maps.forEach(mapConfig => {
      const mapId = mapConfig.name.toLowerCase().replace(/\s+/g, '-');
      registerMap(mapId, mapConfig as MapRegistrationConfig);
    });

    // Assign robots to maps
    config.assignments.forEach(assignment => {
      assignRobotToMap(assignment.robotId, assignment.mapId);
    });

    // Set active map
    if (config.maps.length > 0) {
      const firstMapId = config.maps[0].name.toLowerCase().replace(/\s+/g, '-');
      setActiveMap(firstMapId);
    }
  };

  return {
    config,
    applyPreset,
  };
}
