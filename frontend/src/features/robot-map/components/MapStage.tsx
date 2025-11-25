import type { ProcessedMapData } from '@tensrai/shared';
import type Konva from 'konva';
import { useEffect, useRef } from 'react';
import { useElementSize } from '../../../hooks/useElementSize';
import { useMapControls } from '../hooks/useMapControls';
import { useMapFitting } from '../hooks/useMapFitting';
import { useMapImage } from '../hooks/useMapImage';
import { useMapLocations } from '../hooks/useMapLocations';
import { useZoom } from '../hooks/useZoom';
import { createMapTransforms } from '@/lib/map/mapTransforms';
import type { Robot } from '@/types/robot';
import type { LaserScan, PathMessage, Pose2D } from '@/types/telemetry';
import { laserToPixelPoints, pathToPixelPoints } from '@/lib/map/telemetryTransforms';
import { useRobots } from '../hooks/useRobots';
import { MapContent } from './MapContent';
import { MapErrorBoundary } from './MapErrorBoundary';
import { MapOverlay } from './MapOverlay';
import { useState } from 'react';

interface MapStageProps {
  mapData: ProcessedMapData | null;
  enablePanning?: boolean;
  enableZooming?: boolean;
  width?: number | string;
  height?: number | string;
  className?: string;
  robots?: Robot[] | undefined;
  telemetryRobotId?: string | null | undefined;
  telemetry?:
    | {
        pose?: Pose2D;
        laser?: LaserScan;
      path?: PathMessage;
    }
    | null
    | undefined;
  onRobotSelect?: ((robotId: string) => void) | undefined;
}

export function MapStage({
  mapData,
  enablePanning = true,
  enableZooming = true,
  width = '100%',
  height = '100%',
  className,
  robots: robotsProp,
  telemetryRobotId,
  telemetry,
  onRobotSelect,
}: MapStageProps) {
  const stageRef = useRef<Konva.Stage>(null);
  const mapGroupRef = useRef<Konva.Group>(null);
  const pinRef = useRef<Konva.Group>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const mapImage = useMapImage(mapData, 'default');
  const { ref: containerRef, size: containerSize } = useElementSize<HTMLDivElement>();
  const [stageScale, setStageScale] = useState(1);

  const { locations } = useMapLocations({
    mapData,
  });

  const { data: robotsFetched = [] } = useRobots();
  const robots = robotsProp ?? robotsFetched;

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
    onFit: setStageScale,
  });

  const { rotation, zoomBy, rotateStage, resetView } = useMapControls({
    stageRef,
    mapData,
    fitStageToMap,
    onScaleChange: setStageScale,
  });

  const handleWheel = useZoom({
    enableZooming,
    onZoom: scale => setStageScale(scale),
  });

  useEffect(() => {
    if (mapImage && stageRef.current) {
      stageRef.current.batchDraw();
    }
  }, [mapImage]);

  const transforms = mapData
    ? createMapTransforms({
        width: mapData.meta.width,
        height: mapData.meta.height,
        resolution: mapData.meta.resolution,
        origin: mapData.meta.origin,
      })
    : null;

  const activeRobotPose: Pose2D | undefined =
    (telemetry?.pose as Pose2D | undefined) ??
    (() => {
      if (!telemetryRobotId || !robots.length) return undefined;
      const r = robots.find(robot => robot.id === telemetryRobotId);
      if (r && r.x !== undefined && r.y !== undefined && r.theta !== undefined) {
        return { x: r.x, y: r.y, theta: r.theta };
      }
      return undefined;
    })();

  const laserPoints =
    transforms && telemetry?.laser && activeRobotPose
      ? laserToPixelPoints(telemetry.laser, activeRobotPose, transforms, 2)
      : [];

  const pathPoints =
    transforms && telemetry?.path
      ? pathToPixelPoints(telemetry.path, transforms)
      : [];

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
          robots={robots}
          enablePanning={enablePanning}
          handleWheel={handleWheel}
          laserPoints={laserPoints}
          pathPoints={pathPoints}
          onRobotSelect={onRobotSelect}
          stageScale={stageScale}
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
