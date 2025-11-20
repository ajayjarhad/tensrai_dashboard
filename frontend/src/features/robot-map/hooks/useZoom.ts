import type Konva from 'konva';
import { useCallback } from 'react';

interface UseZoomProps {
  enableZooming: boolean;
  onZoom?: (zoom: number, pan: { x: number; y: number }) => void;
}

export function useZoom({ enableZooming, onZoom }: UseZoomProps) {
  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      if (!enableZooming) return;

      e.evt.preventDefault();

      const stage = e.target.getStage();
      if (!stage) return;

      const oldScale = stage.scaleX();
      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      const scaleBy = 1.05;
      const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;

      // Limit zoom range
      const clampedScale = Math.max(0.1, Math.min(10, newScale));

      // Calculate new position to zoom towards pointer
      const newPos = {
        x: pointer.x - (pointer.x - stage.x()) * (clampedScale / oldScale),
        y: pointer.y - (pointer.y - stage.y()) * (clampedScale / oldScale),
      };

      stage.scale({ x: clampedScale, y: clampedScale });
      stage.position(newPos);
      stage.batchDraw();

      if (onZoom) {
        onZoom(clampedScale, newPos);
      }
    },
    [enableZooming, onZoom]
  );

  return handleWheel;
}
