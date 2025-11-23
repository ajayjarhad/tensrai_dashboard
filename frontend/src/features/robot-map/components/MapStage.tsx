import type { ProcessedMapData } from '@tensrai/shared';
import type Konva from 'konva';
import { useEffect, useRef } from 'react';
import { useElementSize } from '../../../hooks/useElementSize';
import { useMapControls } from '../hooks/useMapControls';
import { useMapFitting } from '../hooks/useMapFitting';
import { useMapImage } from '../hooks/useMapImage';
import { useMapLocations } from '../hooks/useMapLocations';
import { useZoom } from '../hooks/useZoom';
import { MapContent } from './MapContent';
import { MapErrorBoundary } from './MapErrorBoundary';
import { MapOverlay } from './MapOverlay';

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
  const stageRef = useRef<Konva.Stage>(null);
  const mapGroupRef = useRef<Konva.Group>(null);
  const pinRef = useRef<Konva.Group>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const mapImage = useMapImage(mapData, 'default');
  const { ref: containerRef, size: containerSize } = useElementSize<HTMLDivElement>();

  const { locations } = useMapLocations({
    mapData,
  });

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

  const { rotation, zoomBy, rotateStage, resetView } = useMapControls({
    stageRef,
    mapData,
    fitStageToMap,
  });

  const handleWheel = useZoom({
    enableZooming,
  });

  useEffect(() => {
    if (mapImage && stageRef.current) {
      stageRef.current.batchDraw();
    }
  }, [mapImage]);

  if (!mapData) {
    return (
      <div
        className={`flex items-center justify-center bg-muted ${className || ''}`}
        style={{ width, height }}
      >
        <div className="text-muted-foreground">No map data available</div>
      </div>
    );
  }

  return (
    <MapErrorBoundary>
      <div ref={containerRef} className={`relative ${className || ''}`} style={containerStyle}>
        <MapContent
          stageRef={stageRef}
          mapGroupRef={mapGroupRef}
          pinRef={pinRef}
          transformerRef={transformerRef}
          width={resolvedWidth}
          height={resolvedHeight}
          mapData={mapData}
          mapImage={mapImage}
          rotation={rotation}
          locations={locations}
          enablePanning={enablePanning}
          handleWheel={handleWheel}
        />

        <MapOverlay
          onZoomIn={() => zoomBy('in')}
          onZoomOut={() => zoomBy('out')}
          onRotateLeft={() => rotateStage(-15)}
          onRotateRight={() => rotateStage(15)}
          onRecenter={resetView}
        />
      </div>
    </MapErrorBoundary>
  );
}
