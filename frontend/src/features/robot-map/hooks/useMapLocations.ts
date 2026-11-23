import type { ProcessedMapData } from '@tensrai/shared';
import { useMemo } from 'react';
import {
  createMapTransforms,
  headingToRotation,
  worldToMapPixel,
} from '../../../lib/map/mapTransforms';

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
  const locations = useMemo<TempLocation[]>(() => {
    if (!mapData?.features?.locationTags || !mapData.meta) return [];

    const transforms = createMapTransforms(mapData.meta);
    return mapData.features.locationTags.map(tag => {
      const pixelPos = worldToMapPixel({ x: tag.x, y: tag.y }, transforms);
      return {
        id: tag.id,
        name: tag.name,
        x: pixelPos.x,
        y: pixelPos.y,
        // The pin is drawn pointing along +x, so it takes the same turn as the editor's tags.
        rotation: headingToRotation(tag.theta, transforms.origin[2]),
        worldX: tag.x,
        worldY: tag.y,
        thetaRad: tag.theta,
      };
    });
  }, [mapData]);

  return { locations };
}
