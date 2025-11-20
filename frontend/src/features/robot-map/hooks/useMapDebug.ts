import type { MapTransforms } from '@tensrai/shared';
import type Konva from 'konva';
import { useCallback, useState } from 'react';
import { canvasToWorld, createMapPlacement } from '../../../lib/map';
import type { MapDebugInfo } from '../types';

interface UseMapDebugProps {
  initialZoom: number;
  mapTransforms: MapTransforms | null;
  onCoordinateChange?: ((worldCoords: { x: number; y: number } | null) => void) | null;
}

export function useMapDebug({ initialZoom, mapTransforms, onCoordinateChange }: UseMapDebugProps) {
  const [debugInfo, setDebugInfo] = useState<MapDebugInfo>({
    worldCoords: null,
    canvasCoords: null,
    pixelCoords: null,
    zoom: initialZoom,
    pan: { x: 0, y: 0 },
  });

  const getPlacementFromStage = useCallback((stage: Konva.Stage) => {
    return createMapPlacement({
      topLeft: { x: stage.x(), y: stage.y() },
      scale: { x: stage.scaleX(), y: stage.scaleY() },
      rotation: (stage.rotation() * Math.PI) / 180,
    });
  }, []);

  const handleMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const stage = e.target.getStage();
      if (!stage || !mapTransforms) return;

      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      const placement = getPlacementFromStage(stage);
      const worldCoords = canvasToWorld(pointer, placement, mapTransforms);
      setDebugInfo(prev => ({
        ...prev,
        worldCoords,
        canvasCoords: { x: pointer.x, y: pointer.y },
        zoom: stage.scaleX(),
        pan: { x: stage.x(), y: stage.y() },
      }));

      if (onCoordinateChange) {
        onCoordinateChange(worldCoords);
      }
    },
    [mapTransforms, onCoordinateChange, getPlacementFromStage]
  );

  const handleMouseLeave = useCallback(() => {
    setDebugInfo(prev => ({
      ...prev,
      worldCoords: null,
      canvasCoords: null,
      pixelCoords: null,
    }));
    if (onCoordinateChange) {
      onCoordinateChange(null);
    }
  }, [onCoordinateChange]);

  return {
    debugInfo,
    setDebugInfo,
    handleMouseMove,
    handleMouseLeave,
  };
}
