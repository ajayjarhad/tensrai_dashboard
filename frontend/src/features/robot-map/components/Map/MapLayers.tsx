import type { PixelPoint, ProcessedMapData } from '@tensrai/shared';
import type Konva from 'konva';
import { type RefObject, useCallback, useEffect, useState } from 'react';
import { Group, Image as KonvaImage, Layer } from 'react-konva';
import { toast } from 'sonner';
import { clampPixelToBounds, createMapTransforms } from '@/lib/map/mapTransforms';
import type { Robot } from '@/types/robot';
import type { TempLocation } from '../../hooks/useMapLocations';
import { LaserLayer } from '../LaserLayer';
import { PathLayer } from '../PathLayer';
import { LabelsLayer } from './LabelsLayer';
import { LocationLayer } from './LocationLayer';
import { RobotLayer } from './RobotLayer';
import { type PendingPose, SetPoseLayer } from './SetPoseLayer';

interface MapLayersProps {
  stageRef: RefObject<Konva.Stage | null>;
  mapGroupRef: RefObject<Konva.Group | null>;
  mapData: ProcessedMapData;
  mapImage: HTMLImageElement | ImageBitmap | HTMLCanvasElement | undefined;
  rotation: number;
  locations: TempLocation[];
  robots: Robot[];
  laserPoints?: PixelPoint[];
  pathPoints?: PixelPoint[];
  onRobotSelect?: ((robotId: string | null) => void) | undefined;
  stageScale?: number;
  selectedRobotId?: string | null;
  setPoseMode?: boolean;
  onPoseConfirm?: (payload: {
    x: number;
    y: number;
    theta: number;
    source: 'location' | 'manual';
    locationId?: string;
    locationName?: string;
  }) => void;
  onPoseCancel?: () => void;
}

export function MapLayers({
  stageRef,
  mapGroupRef,
  mapData,
  mapImage,
  rotation,
  locations,
  robots,
  laserPoints = [],
  pathPoints = [],
  onRobotSelect,
  stageScale = 1,
  selectedRobotId,
  setPoseMode = false,
  onPoseConfirm,
  onPoseCancel,
}: MapLayersProps) {
  const { width: mapWidth, height: mapHeight, resolution, origin } = mapData.meta;

  const transforms = createMapTransforms({
    width: mapWidth,
    height: mapHeight,
    resolution,
    origin,
  });

  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [pendingPose, setPendingPose] = useState<PendingPose | null>(null);

  useEffect(() => {
    if (selectedLocationId && !locations.some(loc => loc.id === selectedLocationId)) {
      setSelectedLocationId(null);
    }
  }, [locations, selectedLocationId]);

  useEffect(() => {
    if (!setPoseMode) {
      setPendingPose(null);
    }
  }, [setPoseMode]);

  useEffect(() => {
    if (!setPoseMode) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPendingPose(null);
        onPoseCancel?.();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onPoseCancel, setPoseMode]);

  const selectedLocation =
    selectedLocationId !== null && selectedLocationId !== undefined
      ? (locations.find(loc => loc.id === selectedLocationId) ?? null)
      : null;
  const selectedRobot =
    selectedRobotId !== null && selectedRobotId !== undefined
      ? robots.find(robot => robot.id === selectedRobotId)
      : null;

  const pointerToMapPixel = useCallback(() => {
    const stage = stageRef.current;
    const mapGroup = mapGroupRef.current;
    if (!stage || !mapGroup) return null;
    const pointer = stage.getPointerPosition();
    if (!pointer) return null;
    const inverse = mapGroup.getAbsoluteTransform().copy().invert();
    const local = inverse.point(pointer);
    return { x: local.x, y: local.y };
  }, [mapGroupRef, stageRef]);

  const placeManualPose = useCallback(() => {
    if (!transforms) return;
    const pixel = pointerToMapPixel();
    if (!pixel) return;
    const clamped = clampPixelToBounds(pixel, transforms);
    setPendingPose(prev => ({
      source: 'manual',
      pixel: clamped,
      theta: prev?.source === 'manual' ? prev.theta : 0,
      showConfirm: false,
    }));
  }, [pointerToMapPixel, transforms]);

  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    const target = e.target;
    const clickedRobot = target.findAncestor(
      (node: Konva.Node) => typeof node.hasName === 'function' && node.hasName('robot-marker'),
      true
    );
    const clickedLocation = target.findAncestor(
      (node: Konva.Node) => typeof node.hasName === 'function' && node.hasName('location-pin'),
      true
    );

    if (setPoseMode) {
      handleSetPoseModeClick(clickedRobot, clickedLocation);
    } else {
      handleNormalModeClick(clickedRobot, clickedLocation);
    }
  };

  const handleSetPoseModeClick = (
    clickedRobot: Konva.Node | null,
    clickedLocation: Konva.Node | null
  ) => {
    if (clickedRobot || clickedLocation) return;

    if (!pendingPose) {
      placeManualPose();
      return;
    }

    if (pendingPose.source === 'manual' && !pendingPose.showConfirm) {
      setPendingPose(prev =>
        prev && prev.source === 'manual' ? { ...prev, showConfirm: true } : prev
      );
    }
  };

  const handleNormalModeClick = (
    clickedRobot: Konva.Node | null,
    clickedLocation: Konva.Node | null
  ) => {
    if (!clickedRobot && !clickedLocation) {
      onRobotSelect?.(null);
      setSelectedLocationId(null);
    }
  };

  const handleLocationSelect = (
    location: TempLocation,
    evt?: Konva.KonvaEventObject<MouseEvent | TouchEvent>
  ) => {
    if (setPoseMode) {
      if (evt) evt.cancelBubble = true;
      setPendingPose({
        source: 'location',
        location: location,
        pixel: { x: location.x, y: location.y },
        theta: Number.isFinite(location.thetaRad) ? location.thetaRad : 0,
        showConfirm: true,
      });
      return;
    }
    setSelectedLocationId(prev => (prev === location.id ? null : location.id));
  };

  return (
    <>
      {/* Invisible rect to catch clicks on the stage background */}
      <Layer>
        <Group
          ref={mapGroupRef}
          x={mapWidth / 2}
          y={mapHeight / 2}
          offsetX={mapWidth / 2}
          offsetY={mapHeight / 2}
          rotation={rotation}
          onClick={handleStageClick}
          onTap={handleStageClick}
        >
          {mapImage && <KonvaImage image={mapImage} width={mapWidth} height={mapHeight} />}

          <PathLayer points={pathPoints} />

          <LocationLayer
            locations={locations}
            setPoseMode={setPoseMode}
            onLocationSelect={handleLocationSelect}
          />

          <RobotLayer
            robots={robots}
            transforms={transforms}
            resolution={resolution}
            onRobotSelect={(onRobotSelect || (() => {})) ?? undefined}
            setSelectedLocationId={setSelectedLocationId}
          />

          <LaserLayer points={laserPoints} scale={stageScale} />

          <LabelsLayer
            selectedLocation={selectedLocation}
            selectedRobot={selectedRobot ?? null}
            transforms={transforms}
            resolution={resolution}
          />
        </Group>
      </Layer>

      {setPoseMode && pendingPose && (
        <SetPoseLayer
          pendingPose={pendingPose}
          setPendingPose={setPendingPose}
          transforms={transforms}
          resolution={resolution}
          onPoseConfirm={payload => {
            toast.success('Pose updated');
            onPoseConfirm?.(payload);
          }}
          onPoseCancel={() => {
            onPoseCancel?.();
          }}
          pointerToMapPixel={pointerToMapPixel}
        />
      )}
    </>
  );
}
