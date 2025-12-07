import type { ProcessedMapData } from '@tensrai/shared';
import type Konva from 'konva';
import type React from 'react';
import { useEffect } from 'react';
import { Stage } from 'react-konva';
import type { Robot } from '@/types/robot';
import type { TempLocation } from '../../hooks/useMapLocations';
import { MapLayers } from '../Map/MapLayers';
import type { PoseConfirmPayload } from '../Map/SetPoseLayer';

interface MapCanvasProps {
  stageRef: React.RefObject<Konva.Stage | null>;
  mapGroupRef: React.RefObject<Konva.Group | null>;
  mapData: ProcessedMapData;
  mapImage: HTMLImageElement | ImageBitmap | HTMLCanvasElement | undefined;
  robots: Robot[];
  locations: TempLocation[];
  enablePanning?: boolean;
  onRobotSelect?: (robotId: string | null) => undefined | undefined;
  selectedRobotId: string | null;
  stageScale: number;
  setPoseMode?: boolean;
  onPoseConfirm?: (payload: PoseConfirmPayload) => void;
  onPoseCancel?: () => void;
  laserPoints: import('@tensrai/shared').PixelPoint[];
  pathPoints: import('@tensrai/shared').PixelPoint[];
  rotation: number;
  width: number;
  height: number;
  onWheel?: (e: Konva.KonvaEventObject<WheelEvent>) => void;
}

export function MapCanvas({
  stageRef,
  mapGroupRef,
  mapData,
  mapImage,
  robots,
  locations = [],
  enablePanning = true,
  onRobotSelect,
  selectedRobotId,
  stageScale,
  setPoseMode = false,
  onPoseConfirm,
  onPoseCancel,
  laserPoints,
  pathPoints,
  rotation,
  width,
  height,
  onWheel,
}: MapCanvasProps) {
  useEffect(() => {
    if (mapImage && stageRef.current) {
      stageRef.current.batchDraw();
    }
  }, [mapImage, stageRef]); // Add stageRef to dependencies

  return (
    <Stage
      ref={stageRef}
      width={width}
      height={height}
      listening
      draggable={enablePanning && !setPoseMode}
      style={setPoseMode ? { cursor: 'crosshair' } : undefined}
      {...(onWheel ? { onWheel } : {})}
    >
      <MapLayers
        stageRef={stageRef}
        mapGroupRef={mapGroupRef}
        mapData={mapData}
        mapImage={mapImage}
        rotation={rotation}
        locations={locations}
        robots={robots}
        laserPoints={laserPoints}
        pathPoints={pathPoints}
        onRobotSelect={onRobotSelect}
        stageScale={stageScale}
        selectedRobotId={selectedRobotId ?? null}
        setPoseMode={setPoseMode}
        onPoseConfirm={onPoseConfirm ?? (_payload => {})}
        onPoseCancel={onPoseCancel ?? (() => {})}
      />
    </Stage>
  );
}
