/**
 * Example Usage of the ROS Map Rendering Components
 * Demonstrates how to integrate the OccupancyMap component
 */

import { OccupancyMap } from '../components/OccupancyMap';

export function MapExample() {
  return (
    <div className="w-full h-screen bg-gray-50">
      <div className="p-4 bg-white shadow-sm border-b">
        <h1 className="text-2xl font-bold text-gray-900">ROS Map Viewer</h1>
        <p className="text-gray-600">Interactive occupancy grid with pan/zoom controls</p>
      </div>

      <div className="p-4 h-[calc(100vh-120px)]">
        <OccupancyMap
          mapYamlPath="/maps/example_map.yaml"
          showDebugOverlay={true}
          onCoordinateChange={worldCoords => {
            if (worldCoords) {
              console.log(
                `World coordinates: (${worldCoords.x.toFixed(3)}, ${worldCoords.y.toFixed(3)})m`
              );
            }
          }}
        />
      </div>
    </div>
  );
}
