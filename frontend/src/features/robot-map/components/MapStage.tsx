/**
 * Simple map renderer using react-konva
 */

import type { ProcessedMapData } from '@tensrai/shared';
import type Konva from 'konva';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image as KonvaImage, Layer, Stage } from 'react-konva';
import { useElementSize } from '../../../hooks/useElementSize';
import { useMapFitting } from '../hooks/useMapFitting';
import { useMapImage } from '../hooks/useMapImage';
import { useZoom } from '../hooks/useZoom';
import { MapErrorBoundary } from './MapErrorBoundary';
import { MapToolbar } from './MapToolbar';

interface MapStageProps {
  mapData: ProcessedMapData | null;
  enablePanning?: boolean;
  enableZooming?: boolean;
  width?: number | string;
  height?: number | string;
  className?: string;
}

export function MapStage({
  mapData,
  enablePanning = true,
  enableZooming = true,
  width = '100%',
  height = '100%',
  className,
}: MapStageProps) {
  const [rotation, setRotation] = useState(0);
  const stageRef = useRef<Konva.Stage>(null);
  const mapImage = useMapImage(mapData, 'map-stage');
  const { ref: containerRef, size: containerSize } = useElementSize<HTMLDivElement>();
  const mapWidth = mapData?.meta.width ?? 0;
  const mapHeight = mapData?.meta.height ?? 0;

  const resolvedWidth = typeof width === 'number' ? width : containerSize.width || 800;
  const resolvedHeight = typeof height === 'number' ? height : containerSize.height || 600;
  const containerStyle = {
    width: typeof width === 'number' ? `${width}px` : (width ?? '100%'),
    height: typeof height === 'number' ? `${height}px` : (height ?? '100%'),
  };

  const fitStageToMap = useMapFitting({
    mapData,
    stageRef,
    width: resolvedWidth,
    height: resolvedHeight,
  });

  const handleWheel = useZoom({
    enableZooming,
    onZoom: undefined,
  });

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
    },
    [mapData]
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
    }
  }, [fitStageToMap]);

  useEffect(() => {
    if (!mapData || !stageRef.current) return;

    const stage = stageRef.current;
    const { width: mWidth, height: mHeight } = mapData.meta;

    const stageWidth = stage.width();
    const stageHeight = stage.height();
    const scaleX = stageWidth / mWidth;
    const scaleY = stageHeight / mHeight;
    const fitScale = Math.min(scaleX, scaleY) * 0.9;

    stage.scale({ x: fitScale, y: fitScale });
    stage.position({
      x: (stageWidth - mWidth * fitScale) / 2,
      y: (stageHeight - mHeight * fitScale) / 2,
    });
    stage.batchDraw();
  }, [mapData]);

  useEffect(() => {
    if (mapImage && stageRef.current) {
      stageRef.current.batchDraw();
    }
  }, [mapImage]);

  if (!mapData) {
    return (
      <div
        className={`flex items-center justify-center bg-gray-100 ${className || ''}`}
        style={{ width, height }}
      >
        <div className="text-gray-500">No map data available</div>
      </div>
    );
  }

  return (
    <MapErrorBoundary>
      <div ref={containerRef} className={`relative ${className || ''}`} style={containerStyle}>
        <Stage
          ref={stageRef}
          width={resolvedWidth}
          height={resolvedHeight}
          draggable={enablePanning}
          onWheel={handleWheel}
        >
          <Layer>
            {mapImage && (
              <KonvaImage
                image={mapImage}
                x={mapWidth / 2}
                y={mapHeight / 2}
                offsetX={mapWidth / 2}
                offsetY={mapHeight / 2}
                width={mapWidth}
                height={mapHeight}
                rotation={rotation}
              />
            )}
          </Layer>
        </Stage>

        <div className="absolute right-4 top-1/2 -translate-y-1/2">
          <MapToolbar
            onZoomIn={() => zoomBy('in')}
            onZoomOut={() => zoomBy('out')}
            onRotateLeft={() => rotateStage(-15)}
            onRotateRight={() => rotateStage(15)}
            onRecenter={resetView}
          />
        </div>
      </div>
    </MapErrorBoundary>
  );
}
