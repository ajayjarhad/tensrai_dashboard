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

export const RobotMarker = React.memo(
  ({
    x,
    y,
    rotation,
    status,
    widthMeters,
    lengthMeters,
    resolution,
  }: RobotMarkerProps) => {
    // Calculate pixel dimensions
    const widthPixels = widthMeters / resolution;
    const lengthPixels = lengthMeters / resolution;

    // Determine color based on status
    const isEmergency = status === RobotMode.HW_EMERGENCY || status === RobotMode.SW_EMERGENCY;
    const indicatorColor = isEmergency ? '#EF4444' : '#22C55E'; // red-500 : green-500

    return (
      <Group
        x={x}
        y={y}
        rotation={rotation}
        offsetX={widthPixels / 2}
        offsetY={lengthPixels / 2}
        listening
      >
        {/* Robot Body */}
        <Rect
          width={widthPixels}
          height={lengthPixels}
          stroke="black"
          strokeWidth={widthPixels * 0.1} // Proportional stroke width
          cornerRadius={widthPixels * 0.2} // Proportional corner radius
          fill="#828282" // Brand grey fill
          shadowColor="black"
          shadowBlur={5}
          shadowOpacity={0.3}
          shadowOffset={{ x: 2, y: 2 }}
          listening={false}
        />

        {/* Direction Indicator (Triangle) */}
        <RegularPolygon
          x={widthPixels / 2} // Center horizontally
          y={lengthPixels * 0.25} // Position in the top quarter
          sides={3}
          radius={widthPixels * 0.25} // Proportional size
          fill={indicatorColor}
          rotation={0} // Points up (negative Y) by default
          listening={false}
        />
      </Group>
    );
  }
);

RobotMarker.displayName = 'RobotMarker';
