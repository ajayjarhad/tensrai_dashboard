import type { ProcessedMapData } from '@tensrai/shared';
import type Konva from 'konva';
import { useMemo, useRef, useState } from 'react';
import { createMapTransforms } from '@/lib/map/mapTransforms';
import type { Robot } from '@/types/robot';
import type { LaserScan, PathMessage, Pose2D } from '@/types/telemetry';
import { useElementSize } from '../../../hooks/useElementSize';
import { useMapFitting } from '../hooks/useMapFitting';
import { useMapImage } from '../hooks/useMapImage';
import { useMapLocations } from '../hooks/useMapLocations';
import { useRobots } from '../hooks/useRobots';
import { useTelemetryOverlayData } from '../hooks/useTelemetryOverlayData';
import { useZoom } from '../hooks/useZoom';
import type { PoseConfirmPayload } from './Map/SetPoseLayer';
import { MapErrorBoundary } from './MapErrorBoundary';
import { MapCanvas } from './MapStage/MapCanvas';
import { MapControls } from './MapStage/MapControls';
import { useMapInteraction } from './MapStage/useMapInteraction';

interface MapStageProps {
  mapData: ProcessedMapData | null;
  enablePanning?: boolean;
  enableZooming?: boolean;
  width?: number | string;
  height?: number | string;
  className?: string;
  robots?: Robot[] | undefined;
  telemetryRobotId?: string | null | undefined;
  selectedRobotId?: string | null;
  telemetry?:
    | {
        pose?: Pose2D;
        laser?: LaserScan;
        path?: PathMessage;
      }
    | null
    | undefined;
  onRobotSelect?: ((robotId: string | null) => void) | undefined;
  setPoseMode?: boolean;
  onPoseConfirm?: (payload: PoseConfirmPayload) => void;
  onPoseCancel?: () => void;
  highlightTagIds?: string[];
  dimNonMissionTags?: boolean;
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
  selectedRobotId,
  telemetry,
  setPoseMode,
  onPoseConfirm,
  onPoseCancel,
  highlightTagIds,
  dimNonMissionTags,
}: MapStageProps) {
  const { ref: containerRef, size: containerSize } = useElementSize<HTMLDivElement>();
  const [stageScale, setStageScale] = useState(1);

  const mapImage = useMapImage(mapData, 'default');
  const { locations } = useMapLocations({ mapData });

  const { data: robotsFetched = [] } = useRobots(!robotsProp);
  const robots = robotsProp ?? robotsFetched;

  // Stable refs for stage and map group so coordinate transforms and hit testing are reliable
  const stageRef = useRef<Konva.Stage | null>(null);
  const mapGroupRef = useRef<Konva.Group | null>(null);

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

  const { rotation, zoomBy, rotateStage, resetView } = useMapInteraction(
    mapData,
    fitStageToMap,
    setStageScale,
    stageRef
  );

  const handleWheel = useZoom({
    enableZooming,
    onZoom: scale => setStageScale(scale),
  });

  const transforms = useMemo(
    () =>
      mapData
        ? createMapTransforms({
            width: mapData.meta.width,
            height: mapData.meta.height,
            resolution: mapData.meta.resolution,
            origin: mapData.meta.origin,
          })
        : null,
    [mapData]
  );

  const activeRobotPose: Pose2D | undefined = useMemo(() => {
    if (telemetry?.pose) {
      return telemetry.pose as Pose2D;
    }
    if (!telemetryRobotId || !robots.length) return undefined;
    const robot = robots.find(item => item.id === telemetryRobotId);
    if (robot && robot.x !== undefined && robot.y !== undefined && robot.theta !== undefined) {
      return { x: robot.x, y: robot.y, theta: robot.theta };
    }
    return undefined;
  }, [telemetry?.pose, telemetryRobotId, robots]);

  const { laserPoints, pathPoints, overlayBitmap } = useTelemetryOverlayData({
    transforms,
    laser: telemetry?.laser,
    path: telemetry?.path,
    robotPose: activeRobotPose,
    stageScale,
  });

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
        <MapCanvas
          stageRef={stageRef}
          mapGroupRef={mapGroupRef}
          mapData={mapData}
          mapImage={mapImage}
          robots={robots}
          locations={locations}
          selectedRobotId={selectedRobotId ?? null}
          stageScale={stageScale}
          {...(setPoseMode !== undefined ? { setPoseMode } : {})}
          {...(onPoseConfirm ? { onPoseConfirm } : {})}
          {...(onPoseCancel ? { onPoseCancel } : {})}
          laserPoints={laserPoints}
          pathPoints={pathPoints}
          overlayBitmap={overlayBitmap}
          width={resolvedWidth}
          height={resolvedHeight}
          rotation={rotation}
          {...(handleWheel ? { onWheel: handleWheel } : {})}
          enablePanning={enablePanning}
          {...(highlightTagIds ? { highlightTagIds } : {})}
          {...(dimNonMissionTags !== undefined ? { dimNonMissionTags } : {})}
        />

        <MapControls
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
