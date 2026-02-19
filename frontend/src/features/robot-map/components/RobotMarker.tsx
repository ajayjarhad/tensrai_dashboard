import React from 'react';
import { Group, Rect, RegularPolygon } from 'react-konva';
import { RobotMode } from '@/types/robot';

interface RobotMarkerProps {
  x: number;
  y: number;
  rotation: number;
  status: RobotMode;
  widthMeters: number;
  lengthMeters: number;
  resolution: number;
}

const markerColorForStatus = (status: RobotMode) => {
  if (status === RobotMode.HW_EMERGENCY || status === RobotMode.SW_EMERGENCY) {
    return '#EF4444';
  }
  if (status === RobotMode.MISSION) {
    return '#22C55E';
  }
  if (status === RobotMode.TELEOP) {
    return '#F59E0B';
  }
  if (status === RobotMode.CHARGING || status === RobotMode.DOCKING) {
    return '#0EA5E9';
  }
  return '#94A3B8';
};

export const RobotMarker = React.memo(
  ({ x, y, rotation, status, widthMeters, lengthMeters, resolution }: RobotMarkerProps) => {
    const widthPixels = widthMeters / resolution;
    const lengthPixels = lengthMeters / resolution;
    const indicatorColor = markerColorForStatus(status);

    return (
      <Group
        x={x}
        y={y}
        rotation={rotation}
        offsetX={widthPixels / 2}
        offsetY={lengthPixels / 2}
        name="robot-marker"
        listening
      >
        <Rect
          width={widthPixels}
          height={lengthPixels}
          stroke="black"
          strokeWidth={widthPixels * 0.1}
          cornerRadius={widthPixels * 0.2}
          fill="#828282"
          shadowColor="black"
          shadowBlur={5}
          shadowOpacity={0.3}
          shadowOffset={{ x: 2, y: 2 }}
        />

        <RegularPolygon
          x={widthPixels / 2}
          y={lengthPixels * 0.25}
          sides={3}
          radius={widthPixels * 0.25}
          fill={indicatorColor}
          rotation={0}
        />
      </Group>
    );
  }
);

RobotMarker.displayName = 'RobotMarker';
