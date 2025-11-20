/**
 * Interactive Map Stage Component
 * Provides pan/zoom functionality and coordinate transformation helpers
 */

import type Konva from 'konva';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Circle, Image as KonvaImage, Layer, Stage, Text } from 'react-konva';
import { useElementSize } from '../../../hooks/useElementSize';
import { createMapTransforms } from '../../../lib/map';
import { useMapDebug } from '../hooks/useMapDebug';
import { useMapFitting } from '../hooks/useMapFitting';
import { useMapImage } from '../hooks/useMapImage';
import { useZoom } from '../hooks/useZoom';
import type { MapStageProps } from '../types';
import { MapErrorBoundary } from './MapErrorBoundary';

export function MapStage({
  mapData,
  initialZoom = 1.0,
  enablePanning = true,
  enableZooming = true,
  showDebugOverlay = false,
  width = '100%',
  height = '100%',
  onCoordinateChange,
  className,
}: MapStageProps) {
  const { debugInfo, setDebugInfo, handleMouseMove, handleMouseLeave } = useMapDebug({
    initialZoom,
    mapTransforms: mapData ? createMapTransforms(mapData.meta) : null,
    onCoordinateChange,
  });
  const [rotation, setRotation] = useState(0);

  const stageRef = useRef<Konva.Stage>(null);
  const mapImage = useMapImage(mapData);
  const { ref: containerRef, size: containerSize } = useElementSize<HTMLDivElement>();

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
    setDebugInfo,
  });

  const handleWheel = useZoom({
    enableZooming,
    onZoom: (zoom: number, pan: { x: number; y: number }) => {
      setDebugInfo(prev => ({
        ...prev,
        zoom,
        pan,
      }));
    },
  });

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
    const { width: mapWidth, height: mapHeight } = mapData.meta;

    const stageWidth = stage.width();
    const stageHeight = stage.height();
    const scaleX = stageWidth / mapWidth;
    const scaleY = stageHeight / mapHeight;
    const fitScale = Math.min(scaleX, scaleY) * 0.9;

    stage.scale({ x: fitScale, y: fitScale });
    stage.position({
      x: (stageWidth - mapWidth * fitScale) / 2,
      y: (stageHeight - mapHeight * fitScale) / 2,
    });
  }, [mapData]);

  if (!mapData) {
    return (
      <div
        className={`flex items-center justify-center bg-gray-100 ${className}`}
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
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          rotation={rotation}
        >
          <Layer>{mapImage && <KonvaImage image={mapImage} x={0} y={0} />}</Layer>

          {showDebugOverlay && debugInfo.worldCoords && (
            <Layer>
              {debugInfo.canvasCoords && (
                <>
                  <Circle
                    x={debugInfo.canvasCoords.x}
                    y={debugInfo.canvasCoords.y}
                    radius={5}
                    fill="rgba(255, 0, 0, 0.5)"
                    stroke="red"
                    strokeWidth={1}
                  />
                  <Text
                    x={debugInfo.canvasCoords.x + 10}
                    y={debugInfo.canvasCoords.y - 20}
                    text={`(${debugInfo.worldCoords.x.toFixed(2)}, ${debugInfo.worldCoords.y.toFixed(2)})`}
                    fontSize={12}
                    fill="red"
                    padding={4}
                    fillStyle="rgba(0, 0, 0, 0.7)"
                  />
                </>
              )}
            </Layer>
          )}
        </Stage>

        {showDebugOverlay && (
          <div className="absolute top-4 left-4 bg-black bg-opacity-75 text-white p-4 rounded text-sm font-mono">
            <div>Zoom: {debugInfo.zoom.toFixed(3)}x</div>
            <div>
              Pan: ({debugInfo.pan.x.toFixed(1)}, {debugInfo.pan.y.toFixed(1)})
            </div>
            <div>Rotation: {rotation.toFixed(1)}°</div>
            {debugInfo.worldCoords && (
              <>
                <div>
                  World: ({debugInfo.worldCoords.x.toFixed(3)}, {debugInfo.worldCoords.y.toFixed(3)}
                  )m
                </div>
                {debugInfo.canvasCoords && (
                  <div>
                    Canvas: ({debugInfo.canvasCoords.x.toFixed(0)},{' '}
                    {debugInfo.canvasCoords.y.toFixed(0)})px
                  </div>
                )}
              </>
            )}
            <div className="mt-2 text-xs opacity-75">Scroll to zoom, drag to pan</div>
          </div>
        )}

        <div className="absolute bottom-4 right-4 flex flex-col items-end gap-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => rotateStage(-15)}
              className="bg-gray-800 text-white px-3 py-2 rounded shadow hover:bg-gray-700 text-xs font-medium transition-colors"
            >
              Rotate -15°
            </button>
            <button
              type="button"
              onClick={() => rotateStage(15)}
              className="bg-gray-800 text-white px-3 py-2 rounded shadow hover:bg-gray-700 text-xs font-medium transition-colors"
            >
              Rotate +15°
            </button>
          </div>
          <button
            type="button"
            onClick={resetView}
            className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded shadow-lg text-sm font-medium transition-colors"
          >
            Reset View
          </button>
        </div>
      </div>
    </MapErrorBoundary>
  );
}
