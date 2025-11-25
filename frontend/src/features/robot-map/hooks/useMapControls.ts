import type { ProcessedMapData } from '@tensrai/shared';
import type Konva from 'konva';
import { type RefObject, useCallback, useState } from 'react';

interface UseMapControlsProps {
  stageRef: RefObject<Konva.Stage | null>;
  mapData: ProcessedMapData | null;
  fitStageToMap: () => void;
  onScaleChange?: (scale: number) => void;
}

export function useMapControls({
  stageRef,
  mapData,
  fitStageToMap,
  onScaleChange,
}: UseMapControlsProps) {
  const [rotation, setRotation] = useState(0);

  const zoomBy = useCallback(
    (direction: 'in' | 'out') => {
      const stage = stageRef.current;
      if (!stage || !mapData) return;

      const oldScale = stage.scaleX();
      const scaleBy = 1.2;
      const newScale = direction === 'in' ? oldScale * scaleBy : oldScale / scaleBy;
      const clampedScale = Math.max(0.1, Math.min(10, newScale));

      const center = {
        x: stage.width() / 2,
        y: stage.height() / 2,
      };

      const relatedTo = {
        x: (center.x - stage.x()) / oldScale,
        y: (center.y - stage.y()) / oldScale,
      };

      const newPos = {
        x: center.x - relatedTo.x * clampedScale,
        y: center.y - relatedTo.y * clampedScale,
      };

      stage.scale({ x: clampedScale, y: clampedScale });
      stage.position(newPos);
      stage.batchDraw();
      onScaleChange?.(clampedScale);
    },
    [mapData, onScaleChange, stageRef]
  );

  const rotateStage = useCallback((deltaDegrees: number) => {
    setRotation(prev => prev + deltaDegrees);
  }, []);

  const resetView = useCallback(() => {
    setRotation(0);
    fitStageToMap();
    const stage = stageRef.current;
    if (stage) {
      stage.rotation(0);
      stage.batchDraw();
      onScaleChange?.(stage.scaleX());
    }
  }, [fitStageToMap, onScaleChange, stageRef]);

  return {
    rotation,
    zoomBy,
    rotateStage,
    resetView,
  };
}
