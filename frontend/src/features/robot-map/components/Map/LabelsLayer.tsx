import { Label, Tag, Text } from '@/lib/map/konva';
import type { MapTransforms } from '@/lib/map/mapTransforms';
import { worldToMapPixel } from '@/lib/map/mapTransforms';
import type { Robot } from '@/types/robot';
import type { TempLocation } from '../../hooks/useMapLocations';

interface LabelsLayerProps {
  selectedLocation: TempLocation | null;
  selectedRobot: Robot | null;
  transforms: MapTransforms | null;
  resolution: number;
}

export function LabelsLayer({
  selectedLocation,
  selectedRobot,
  transforms,
  resolution,
}: LabelsLayerProps) {
  const ROBOT_LENGTH_METERS = 1.6;
  const robotLengthPixels = ROBOT_LENGTH_METERS / resolution;

  const selectedRobotPixelPoint =
    selectedRobot &&
    selectedRobot.x !== undefined &&
    selectedRobot.y !== undefined &&
    selectedRobot.theta !== undefined &&
    transforms
      ? worldToMapPixel({ x: selectedRobot.x, y: selectedRobot.y }, transforms)
      : null;

  return (
    <>
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
    </>
  );
}
