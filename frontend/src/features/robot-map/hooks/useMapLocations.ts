import type { ProcessedMapData } from '@tensrai/shared';
import { useEffect, useState } from 'react';
import { createMapTransforms, worldToMapPixel } from '../../../lib/map/mapTransforms';

export interface TempLocation {
  id: string;
  name: string;
  x: number;
  y: number;
  rotation: number;
  worldX: number;
  worldY: number;
  thetaRad: number;
}

export function useMapLocations({ mapData }: { mapData: ProcessedMapData | null }) {
  const [locations, setLocations] = useState<TempLocation[]>([]);

  // Initialize locations from map data features
  useEffect(() => {
    if (mapData?.features?.locationTags && mapData.meta) {
      const transforms = createMapTransforms(mapData.meta);

      setLocations(
        mapData.features.locationTags.map(tag => {
          const pixelPos = worldToMapPixel({ x: tag.x, y: tag.y }, transforms);
          // Adjust rotation by subtracting map origin rotation (if any)
          // theta is in radians, convert to degrees for Konva
          // Konva rotation is clockwise, ROS is counter-clockwise, but mapTransforms handles coordinate system
          // For simple pins, we just convert radians to degrees.
          // Ideally we should also adjust for origin yaw: (tag.theta - originYaw) * (180/PI)
          // But let's stick to the requested translation first.

          return {
            id: tag.id,
            name: tag.name,
            x: pixelPos.x,
            y: pixelPos.y,
            rotation: tag.theta * (180 / Math.PI),
            worldX: tag.x,
            worldY: tag.y,
            thetaRad: tag.theta,
          };
        })
      );
    } else {
      setLocations([]);
    }
  }, [mapData]);

  return {
    locations,
  };
}
