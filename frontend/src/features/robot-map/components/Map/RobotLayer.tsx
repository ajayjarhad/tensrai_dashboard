import { Group } from 'react-konva';
import type { MapTransforms } from '@/lib/map/mapTransforms';
import { worldToMapPixel } from '@/lib/map/mapTransforms';
import { getRobotDisplayMode } from '@/lib/robotStatus';
import type { Robot } from '@/types/robot';
import { RobotMarker } from '../RobotMarker';

interface RobotLayerProps {
  robots: Robot[];
  transforms: MapTransforms | null;
  resolution: number;
  onRobotSelect?: (robotId: string | null) => void;
  setSelectedLocationId: (id: string | null) => void;
}

export function RobotLayer({
  robots,
  transforms,
  resolution,
  onRobotSelect,
  setSelectedLocationId,
}: RobotLayerProps) {
  if (!transforms) return null;

  // Default robot dimensions in meters
  const ROBOT_WIDTH_METERS = 1.1;
  const ROBOT_LENGTH_METERS = 1.6;

  return (
    <>
      {robots.map(robot => {
        const x = robot.x;
        const y = robot.y;
        const theta = robot.theta;
        if (
          typeof x !== 'number' ||
          typeof y !== 'number' ||
          typeof theta !== 'number' ||
          !Number.isFinite(x) ||
          !Number.isFinite(y) ||
          !Number.isFinite(theta)
        ) {
          return null;
        }

        const pixelPoint = worldToMapPixel({ x, y }, transforms);
        const rotationDegrees = 90 - theta * (180 / Math.PI);
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
              status={getRobotDisplayMode(robot)}
              widthMeters={ROBOT_WIDTH_METERS}
              lengthMeters={ROBOT_LENGTH_METERS}
              resolution={resolution}
            />
          </Group>
        );
      })}
    </>
  );
}
