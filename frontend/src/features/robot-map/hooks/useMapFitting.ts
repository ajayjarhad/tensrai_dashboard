import type { ProcessedMapData } from '@tensrai/shared';
import type Konva from 'konva';
import { useCallback, useEffect } from 'react';
import type { MapDebugInfo } from '../types';

interface UseMapFittingProps {
  mapData: ProcessedMapData | null;
  stageRef: React.RefObject<Konva.Stage | null>;
  width: number;
  height: number;
  setDebugInfo: React.Dispatch<React.SetStateAction<MapDebugInfo>>;
}

export function useMapFitting({
  mapData,
  stageRef,
  width,
  height,
  setDebugInfo,
}: UseMapFittingProps) {
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

    setDebugInfo(prev => ({
      ...prev,
      zoom: fitScale,
      pan: { x: stage.x(), y: stage.y() },
    }));
  }, [mapData, width, height, setDebugInfo, stageRef]);

  // Auto-fit on data change
  useEffect(() => {
    if (mapData) {
      fitStageToMap();
    }
  }, [fitStageToMap, mapData]);

  return fitStageToMap;
}
