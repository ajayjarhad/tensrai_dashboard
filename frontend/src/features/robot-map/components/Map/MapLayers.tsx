import type { ProcessedMapData } from '@tensrai/shared';
import type Konva from 'konva';
import { type RefObject, useCallback, useEffect, useMemo, useState } from 'react';
import { Group, Image as KonvaImage, Layer, Rect } from 'react-konva';
import { toast } from 'sonner';
import { clampPixelToBounds, createMapTransforms } from '@/lib/map/mapTransforms';
import type { Robot } from '@/types/robot';
import type { TempLocation } from '../../hooks/useMapLocations';
import { LaserLayer } from '../LaserLayer';
import { PathLayer } from '../PathLayer';
import { LabelsLayer } from './LabelsLayer';
import { LocationLayer } from './LocationLayer';
import { RobotLayer } from './RobotLayer';
import { type PendingPose, type PoseConfirmPayload, SetPoseLayer } from './SetPoseLayer';

const EMPTY_FLOATS = new Float32Array(0);

interface MapLayersProps {
  stageRef: RefObject<Konva.Stage | null>;
  mapGroupRef: RefObject<Konva.Group | null>;
  mapData: ProcessedMapData;
  mapImage: HTMLImageElement | ImageBitmap | HTMLCanvasElement | undefined;
  rotation: number;
  locations: TempLocation[];
  robots: Robot[];
  laserPoints?: Float32Array;
  pathPoints?: Float32Array;
  overlayBitmap?: ImageBitmap | undefined;
  onRobotSelect?: ((robotId: string | null) => void) | undefined;
  stageScale?: number;
  selectedRobotId?: string | null;
  setPoseMode?: boolean;
  onPoseConfirm?: (payload: PoseConfirmPayload) => void;
  onPoseCancel?: () => void;
  highlightTagIds?: string[];
  dimNonMissionTags?: boolean;
}

export function MapLayers({
  stageRef,
  mapGroupRef,
  mapData,
  mapImage,
  rotation,
  locations,
  robots,
  laserPoints = EMPTY_FLOATS,
  pathPoints = EMPTY_FLOATS,
  overlayBitmap,
  onRobotSelect,
  stageScale = 1,
  selectedRobotId,
  setPoseMode = false,
  onPoseConfirm,
  onPoseCancel,
  highlightTagIds,
  dimNonMissionTags = false,
}: MapLayersProps) {
  const { width: mapWidth, height: mapHeight, resolution, origin } = mapData.meta;

  const transforms = createMapTransforms({
    width: mapWidth,
    height: mapHeight,
    resolution,
    origin,
  });
  const highlightTagIdSet = useMemo(
    () => (highlightTagIds ? new Set(highlightTagIds) : undefined),
    [highlightTagIds]
  );
  const sharedGroupProps = {
    x: mapWidth / 2,
    y: mapHeight / 2,
    offsetX: mapWidth / 2,
    offsetY: mapHeight / 2,
    rotation,
  } as const;

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
      pixel: clamped,
      theta: prev?.theta ?? 0,
      showConfirm: false,
    }));
  }, [pointerToMapPixel, transforms]);

  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (setPoseMode) {
      handleSetPoseModeClick();
      return;
    }
    const target = e.target;
    const clickedRobot = target.findAncestor(
      (node: Konva.Node) => typeof node.hasName === 'function' && node.hasName('robot-marker'),
      true
    );
    const clickedLocation = target.findAncestor(
      (node: Konva.Node) => typeof node.hasName === 'function' && node.hasName('location-pin'),
      true
    );
    handleNormalModeClick(clickedRobot, clickedLocation);
  };

  const handleSetPoseModeClick = () => {
    if (!pendingPose) {
      placeManualPose();
      return;
    }
    if (!pendingPose.showConfirm) {
      setPendingPose(prev => (prev ? { ...prev, showConfirm: true } : prev));
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

  const handleLocationSelect = (location: TempLocation) => {
    setSelectedLocationId(prev => (prev === location.id ? null : location.id));
  };

  return (
    <>
      <Layer>
        <Group ref={mapGroupRef} {...sharedGroupProps}>
          {mapImage && <KonvaImage image={mapImage} width={mapWidth} height={mapHeight} />}
        </Group>
      </Layer>

      <Layer listening={false}>
        <Group {...sharedGroupProps}>
          {overlayBitmap ? (
            <KonvaImage image={overlayBitmap} width={mapWidth} height={mapHeight} />
          ) : (
            <>
              <PathLayer points={pathPoints} />
              <LaserLayer points={laserPoints} scale={stageScale} />
            </>
          )}
        </Group>
      </Layer>

      <Layer>
        <Group {...sharedGroupProps} onClick={handleStageClick} onTap={handleStageClick}>
          <Rect width={mapWidth} height={mapHeight} fill="rgba(0,0,0,0)" />
          <LocationLayer
            locations={locations}
            setPoseMode={setPoseMode}
            {...(highlightTagIdSet ? { highlightTagIds: highlightTagIdSet } : {})}
            {...(dimNonMissionTags !== undefined ? { dimNonMissionTags } : {})}
            onLocationSelect={handleLocationSelect}
          />

          <RobotLayer
            robots={robots}
            transforms={transforms}
            resolution={resolution}
            onRobotSelect={(onRobotSelect || (() => {})) ?? undefined}
            setSelectedLocationId={setSelectedLocationId}
            setPoseMode={setPoseMode}
          />

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
            if (onPoseConfirm) {
              onPoseConfirm(payload);
            } else {
              toast.success('Pose updated');
            }
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
