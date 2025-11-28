import type { PixelPoint, ProcessedMapData } from '@tensrai/shared';
import type Konva from 'konva';
import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import {
  Circle,
  Group,
  Image as KonvaImage,
  Label,
  Layer,
  Line,
  Rect,
  Stage,
  Tag,
  Text,
} from 'react-konva';
import { toast } from 'sonner';
import {
  clampPixelToBounds,
  createMapTransforms,
  mapPixelToWorld,
  worldAngle,
  worldToMapPixel,
} from '@/lib/map/mapTransforms';
import { type Robot, RobotMode } from '@/types/robot';
import type { TempLocation } from '../hooks/useMapLocations';
import { LaserLayer } from './LaserLayer';
import { LocationPin } from './LocationPin';
import { PathLayer } from './PathLayer';
import { RobotMarker } from './RobotMarker';

interface MapContentProps {
  stageRef: RefObject<Konva.Stage | null>;
  mapGroupRef: RefObject<Konva.Group | null>;
  pinRef: RefObject<Konva.Group | null>;
  transformerRef: RefObject<Konva.Transformer | null>;
  width: number;
  height: number;
  mapData: ProcessedMapData;
  mapImage: HTMLImageElement | ImageBitmap | HTMLCanvasElement | undefined;
  rotation: number;
  locations: TempLocation[];
  robots: Robot[];
  enablePanning: boolean;
  handleWheel: (e: Konva.KonvaEventObject<WheelEvent>) => void;
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

export function MapContent({
  stageRef,
  mapGroupRef,
  width,
  height,
  mapData,
  mapImage,
  rotation,
  locations,
  robots,
  enablePanning,
  handleWheel,
  laserPoints = [],
  pathPoints = [],
  onRobotSelect,
  stageScale = 1,
  selectedRobotId,
  setPoseMode = false,
  onPoseConfirm,
  onPoseCancel,
}: MapContentProps) {
  const { width: mapWidth, height: mapHeight, resolution, origin } = mapData.meta;

  // Create transforms object for coordinate conversion
  const transforms = createMapTransforms({
    width: mapWidth,
    height: mapHeight,
    resolution,
    origin,
  });

  // Default robot dimensions in meters
  const ROBOT_WIDTH_METERS = 1.1;
  const ROBOT_LENGTH_METERS = 1.6;
  const robotLengthPixels = ROBOT_LENGTH_METERS / resolution;
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  type PendingPose =
    | {
        source: 'location';
        location: TempLocation;
        pixel: PixelPoint;
        theta: number;
        showConfirm: true;
      }
    | {
        source: 'manual';
        pixel: PixelPoint;
        theta: number;
        showConfirm: boolean;
      };
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
    selectedLocationId !== null ? locations.find(loc => loc.id === selectedLocationId) : null;
  const selectedRobot =
    selectedRobotId !== null ? robots.find(robot => robot.id === selectedRobotId) : null;
  const selectedRobotPixelPoint =
    selectedRobot &&
    selectedRobot.x !== undefined &&
    selectedRobot.y !== undefined &&
    selectedRobot.theta !== undefined
      ? worldToMapPixel({ x: selectedRobot.x, y: selectedRobot.y }, transforms)
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

  const cancelPose = useCallback(() => {
    setPendingPose(null);
    onPoseCancel?.();
  }, [onPoseCancel]);

  const confirmPose = useCallback(() => {
    if (!pendingPose || !transforms) return;
    const worldPoint = mapPixelToWorld(pendingPose.pixel, transforms);
    const theta = pendingPose.theta ?? 0;
    console.log('[SetPose]', { x: worldPoint.x, y: worldPoint.y, theta });
    toast.success('Pose updated');
    onPoseConfirm?.({
      x: worldPoint.x,
      y: worldPoint.y,
      theta,
      source: pendingPose.source,
      locationId: pendingPose.source === 'location' ? pendingPose.location.id : undefined,
      locationName: pendingPose.source === 'location' ? pendingPose.location.name : undefined,
    });
    setPendingPose(null);
  }, [onPoseConfirm, pendingPose, transforms]);

  const updateRotationFromPointer = useCallback(
    (pixelPoint: PixelPoint) => {
      if (!transforms) return;
      setPendingPose(prev => {
        if (!prev || prev.source !== 'manual') return prev;
        const centerWorld = mapPixelToWorld(prev.pixel, transforms);
        const pointerWorld = mapPixelToWorld(pixelPoint, transforms);
        const theta = worldAngle(centerWorld, pointerWorld);
        return { ...prev, theta };
      });
    },
    [transforms]
  );

  const pendingRotationDegrees =
    pendingPose && pendingPose.source === 'manual' ? 90 - (pendingPose.theta * 180) / Math.PI : 90;

  const handleRadius = robotLengthPixels + 18;
  const handleOffset = useMemo(() => {
    if (!pendingPose || pendingPose.source !== 'manual') {
      return { x: 0, y: -handleRadius };
    }
    const rad = ((pendingRotationDegrees - 90) * Math.PI) / 180;
    return {
      x: handleRadius * Math.cos(rad),
      y: handleRadius * Math.sin(rad),
    };
  }, [handleRadius, pendingPose, pendingRotationDegrees]);

  const handleRotationDrag = useCallback(
    (evt: Konva.KonvaEventObject<MouseEvent>) => {
      const pixel = pointerToMapPixel();
      if (pixel) {
        updateRotationFromPointer(pixel);
      }
      if (evt?.target?.position) {
        evt.target.position({ x: handleOffset.x, y: handleOffset.y });
      }
    },
    [handleOffset.x, handleOffset.y, pointerToMapPixel, updateRotationFromPointer]
  );

  return (
    <Stage
      ref={stageRef}
      width={width}
      height={height}
      style={{ cursor: setPoseMode ? 'crosshair' : undefined }}
      draggable={enablePanning && !setPoseMode}
      onWheel={handleWheel}
      onClick={e => {
        const target = e.target;
        const clickedRobot = target.findAncestor(
          node => typeof node.hasName === 'function' && node.hasName('robot-marker'),
          true
        );
        const clickedLocation = target.findAncestor(
          node => typeof node.hasName === 'function' && node.hasName('location-pin'),
          true
        );

        if (setPoseMode) {
          if (clickedRobot) return;
          if (clickedLocation) {
            return;
          }

          if (!pendingPose) {
            placeManualPose();
            return;
          }

          if (pendingPose.source === 'manual' && !pendingPose.showConfirm) {
            setPendingPose(prev =>
              prev && prev.source === 'manual' ? { ...prev, showConfirm: true } : prev
            );
            return;
          }

          return;
        }

        if (!clickedRobot && !clickedLocation) {
          onRobotSelect?.(null);
          setSelectedLocationId(null);
        }
      }}
    >
      <Layer>
        <Group
          ref={mapGroupRef}
          x={mapWidth / 2}
          y={mapHeight / 2}
          offsetX={mapWidth / 2}
          offsetY={mapHeight / 2}
          rotation={rotation}
        >
          {mapImage && <KonvaImage image={mapImage} width={mapWidth} height={mapHeight} />}

          <PathLayer points={pathPoints} />

          {locations.map(loc => {
            const handleLocationSelect = (evt?: Konva.KonvaEventObject<MouseEvent>) => {
              if (setPoseMode) {
                if (evt) evt.cancelBubble = true;
                setPendingPose({
                  source: 'location',
                  location: loc,
                  pixel: { x: loc.x, y: loc.y },
                  theta: Number.isFinite(loc.thetaRad) ? loc.thetaRad : 0,
                  showConfirm: true,
                });
                return;
              }
              setSelectedLocationId(prev => (prev === loc.id ? null : loc.id));
            };

            return (
              <LocationPin
                key={loc.id}
                x={loc.x}
                y={loc.y}
                rotation={loc.rotation}
                name="location-pin"
                onClick={handleLocationSelect}
                onTap={handleLocationSelect}
              />
            );
          })}

          {/* Render Robots above location pins */}
          {robots?.map(robot => {
            if (robot.x === undefined || robot.y === undefined || robot.theta === undefined) {
              return null;
            }

            const pixelPoint = worldToMapPixel({ x: robot.x, y: robot.y }, transforms);
            const rotationDegrees = 90 - robot.theta * (180 / Math.PI);
            const handleSelect = () => {
              setSelectedLocationId(null);
              onRobotSelect?.(robot.id);
            };

            return (
              <Group key={robot.id} onClick={handleSelect} onTap={handleSelect}>
                <RobotMarker
                  x={pixelPoint.x}
                  y={pixelPoint.y}
                  rotation={rotationDegrees}
                  status={robot.status}
                  widthMeters={ROBOT_WIDTH_METERS}
                  lengthMeters={ROBOT_LENGTH_METERS}
                  resolution={resolution}
                />
              </Group>
            );
          })}

          <LaserLayer points={laserPoints} scale={stageScale} />

          {selectedLocation && (
            <Label x={selectedLocation.x} y={selectedLocation.y - 18} listening={false}>
              <Tag
                fill="rgba(15, 23, 42, 0.9)"
                cornerRadius={6}
                pointerDirection="down"
                pointerWidth={10}
                pointerHeight={6}
                shadowColor="black"
                shadowBlur={8}
                shadowOpacity={0.25}
                shadowOffset={{ x: 1, y: 2 }}
              />
              <Text
                text={selectedLocation.name || 'Location'}
                fontSize={13}
                padding={7}
                fill="#fff"
                fontFamily="Inter, system-ui, -apple-system, sans-serif"
                align="center"
              />
            </Label>
          )}

          {selectedRobotPixelPoint && (
            <Label
              x={selectedRobotPixelPoint.x}
              y={selectedRobotPixelPoint.y - robotLengthPixels / 2 - 6}
              listening={false}
            >
              <Tag
                fill="rgba(15, 23, 42, 0.9)"
                cornerRadius={6}
                pointerDirection="down"
                pointerWidth={10}
                pointerHeight={6}
                shadowColor="black"
                shadowBlur={8}
                shadowOpacity={0.25}
                shadowOffset={{ x: 1, y: 2 }}
              />
              <Text
                text={selectedRobot?.name || 'Robot'}
                fontSize={14}
                padding={8}
                fill="#fff"
                fontFamily="Inter, system-ui, -apple-system, sans-serif"
                align="center"
              />
            </Label>
          )}
        </Group>
      </Layer>

      {setPoseMode && pendingPose && (
        <Layer listening>
          <Group
            x={pendingPose.pixel.x}
            y={pendingPose.pixel.y}
            opacity={0.95}
            onClick={evt => {
              evt.cancelBubble = true;
            }}
            onTap={evt => {
              evt.cancelBubble = true;
            }}
            onMouseDown={evt => {
              evt.cancelBubble = true;
            }}
          >
            {pendingPose.source === 'manual' && (
              <>
                <Circle
                  radius={handleRadius}
                  stroke="#22c55e"
                  strokeWidth={1}
                  dash={[6, 6]}
                  opacity={0.55}
                  listening={false}
                />
                <Line
                  points={[0, 0, handleOffset.x, handleOffset.y]}
                  stroke="#22c55e"
                  strokeWidth={2}
                  opacity={0.8}
                  listening={false}
                />
                <RobotMarker
                  x={0}
                  y={0}
                  rotation={pendingRotationDegrees}
                  status={RobotMode.UNKNOWN}
                  widthMeters={ROBOT_WIDTH_METERS}
                  lengthMeters={ROBOT_LENGTH_METERS}
                  resolution={resolution}
                />

                <Group
                  x={handleOffset.x}
                  y={handleOffset.y}
                  draggable
                  dragBoundFunc={() => ({ x: handleOffset.x, y: handleOffset.y })}
                  onDragMove={handleRotationDrag}
                  onDragEnd={handleRotationDrag}
                  onMouseDown={evt => {
                    evt.cancelBubble = true;
                  }}
                  onTap={evt => {
                    evt.cancelBubble = true;
                  }}
                >
                  <Circle
                    radius={10}
                    fill="#22c55e"
                    stroke="#16a34a"
                    strokeWidth={2}
                    shadowColor="black"
                    shadowBlur={4}
                    shadowOpacity={0.22}
                    shadowOffset={{ x: 1, y: 2 }}
                  />
                  <Text
                    text="⟳"
                    fontSize={10}
                    fontFamily="Inter, system-ui, -apple-system, sans-serif"
                    fill="#0f172a"
                    offsetX={4}
                    offsetY={6}
                  />
                </Group>
              </>
            )}

            {(pendingPose.source === 'location' || pendingPose.showConfirm) && (
              <Group
                y={pendingPose.source === 'manual' ? -robotLengthPixels / 2 - 125 : -90}
                offsetX={120}
              >
                <Rect
                  width={240}
                  height={pendingPose.source === 'manual' ? 132 : 118}
                  fill="rgba(15, 23, 42, 0.9)"
                  cornerRadius={12}
                  shadowColor="black"
                  shadowBlur={10}
                  shadowOpacity={0.3}
                  shadowOffset={{ x: 2, y: 3 }}
                />
                <Text
                  x={16}
                  y={18}
                  width={208}
                  wrap="word"
                  lineHeight={1.25}
                  align="left"
                  text={
                    pendingPose.source === 'location'
                      ? `Use ${pendingPose.location.name || 'location'}`
                      : 'Robot will have this pose'
                  }
                  fontSize={14}
                  fill="#ffffff"
                  fontStyle="bold"
                  fontFamily="Inter, system-ui, -apple-system, sans-serif"
                />
                <Group
                  x={16}
                  y={pendingPose.source === 'manual' ? 76 : 66}
                  onClick={evt => {
                    evt.cancelBubble = true;
                    confirmPose();
                  }}
                  onTap={evt => {
                    evt.cancelBubble = true;
                    confirmPose();
                  }}
                >
                  <Rect width={96} height={36} fill="#22c55e" cornerRadius={8} />
                  <Text
                    x={16}
                    y={11}
                    text="Confirm"
                    fontSize={12}
                    fill="#0f172a"
                    fontFamily="Inter, system-ui, -apple-system, sans-serif"
                  />
                </Group>
                <Group
                  x={124}
                  y={pendingPose.source === 'manual' ? 76 : 66}
                  onClick={evt => {
                    evt.cancelBubble = true;
                    cancelPose();
                  }}
                  onTap={evt => {
                    evt.cancelBubble = true;
                    cancelPose();
                  }}
                >
                  <Rect width={96} height={36} fill="#1f2937" cornerRadius={8} stroke="#334155" />
                  <Text
                    x={18}
                    y={11}
                    text="Cancel"
                    fontSize={12}
                    fill="#e2e8f0"
                    fontFamily="Inter, system-ui, -apple-system, sans-serif"
                  />
                </Group>
              </Group>
            )}
          </Group>
        </Layer>
      )}
    </Stage>
  );
}
