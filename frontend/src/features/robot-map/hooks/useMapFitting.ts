import type { ProcessedMapData } from '@tensrai/shared';
import type Konva from 'konva';
import type { RefObject } from 'react';
import { useCallback, useEffect } from 'react';

interface UseMapFittingProps {
  mapData: ProcessedMapData | null;
  stageRef: RefObject<Konva.Stage | null>;
  width: number;
  height: number;
  onFit?: (scale: number) => void;
}

export function useMapFitting({ mapData, stageRef, width, height, onFit }: UseMapFittingProps) {
  const fitStageToMap = useCallback(() => {
    if (!mapData || !stageRef.current) {
      return;
    }

    const stage = stageRef.current;
    if (width === 0 || height === 0) {
      return;
    }

    const { width: mapWidth, height: mapHeight } = mapData.meta;
    const scaleX = width / mapWidth;
    const scaleY = height / mapHeight;
    const fitScale = Math.min(scaleX, scaleY) * 0.9;

    stage.scale({ x: fitScale, y: fitScale });
    stage.position({
      x: (width - mapWidth * fitScale) / 2,
      y: (height - mapHeight * fitScale) / 2,
    });
    stage.batchDraw();
    onFit?.(fitScale);
  }, [mapData, width, height, stageRef, onFit]);

  // Auto-fit on data change
  useEffect(() => {
    if (mapData) {
      fitStageToMap();
    }
  }, [fitStageToMap, mapData]);

  return fitStageToMap;
}
