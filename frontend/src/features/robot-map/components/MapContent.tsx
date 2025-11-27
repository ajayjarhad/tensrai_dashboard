import type { PixelPoint, ProcessedMapData } from '@tensrai/shared';
import type Konva from 'konva';
import type { RefObject } from 'react';
import { Group, Image as KonvaImage, Label, Layer, Stage, Tag, Text } from 'react-konva';
import { createMapTransforms, worldToMapPixel } from '@/lib/map/mapTransforms';
import type { Robot } from '@/types/robot';
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

  return (
    <Stage
      ref={stageRef}
      width={width}
      height={height}
      draggable={enablePanning}
      onWheel={handleWheel}
      onClick={e => {
        const target = e.target;
        const clickedRobot = target.findAncestor(
          node => typeof node.hasName === 'function' && node.hasName('robot-marker'),
          true
        );

        if (!clickedRobot) {
          onRobotSelect?.(null);
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

          {/* Render Robots */}
          {robots?.map(robot => {
            if (robot.x === undefined || robot.y === undefined || robot.theta === undefined) {
              return null;
            }

            // Convert world coordinates (meters) to pixel coordinates
            const pixelPoint = worldToMapPixel({ x: robot.x, y: robot.y }, transforms);
            const isSelected = robot.id === selectedRobotId;

            // For rotation:
            // ROS: +Z is CCW, 0 is East.
            // Konva: +Rotation is CW.
            // Our sprite points "Up" (North) at 0 rotation.
            // To point East (theta=0), we need rotation=90.
            // To point North (theta=90), we need rotation=0.
            // Formula: 90 - theta_deg
            const rotationDegrees = 90 - robot.theta * (180 / Math.PI);
            const handleSelect = () => onRobotSelect?.(robot.id);

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
                {isSelected && (
                  <Label
                    x={pixelPoint.x}
                    y={pixelPoint.y - robotLengthPixels / 2 - 6}
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
                      text={robot.name || 'Robot'}
                      fontSize={14}
                      padding={8}
                      fill="#fff"
                      fontFamily="Inter, system-ui, -apple-system, sans-serif"
                      align="center"
                    />
                  </Label>
                )}
              </Group>
            );
          })}

          {locations.map(loc => (
            <LocationPin key={loc.id} x={loc.x} y={loc.y} rotation={loc.rotation} />
          ))}

          <LaserLayer points={laserPoints} scale={stageScale} />
        </Group>
      </Layer>
    </Stage>
  );
}
