import React, { useEffect, useState } from 'react';
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
    const isEmergency = status === RobotMode.HW_EMERGENCY || status === RobotMode.SW_EMERGENCY;
    const [pulsePhase, setPulsePhase] = useState(0);

    useEffect(() => {
      if (!isEmergency) {
        setPulsePhase(0);
        return;
      }

      let frame = 0;
      const timer = window.setInterval(() => {
        frame += 1;
        setPulsePhase(frame);
      }, 90);

      return () => window.clearInterval(timer);
    }, [isEmergency]);

    const pulseOpacity = isEmergency ? 0.6 + (Math.sin(pulsePhase * 0.45) + 1) * 0.2 : 1;
    const pulseScale = isEmergency ? 1 + (Math.sin(pulsePhase * 0.45) + 1) * 0.06 : 1;

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
          stroke={isEmergency ? indicatorColor : 'black'}
          strokeWidth={widthPixels * 0.1}
          cornerRadius={widthPixels * 0.2}
          fill="#828282"
          shadowColor={isEmergency ? indicatorColor : 'black'}
          shadowBlur={isEmergency ? 10 : 5}
          shadowOpacity={isEmergency ? 0.45 : 0.3}
          shadowOffset={{ x: 2, y: 2 }}
        />

        <RegularPolygon
          x={widthPixels / 2}
          y={lengthPixels * 0.25}
          sides={3}
          radius={widthPixels * 0.25}
          fill={indicatorColor}
          opacity={pulseOpacity}
          rotation={0}
          scaleX={pulseScale}
          scaleY={pulseScale}
          shadowColor={indicatorColor}
          shadowBlur={isEmergency ? 16 : 0}
          shadowOpacity={isEmergency ? 0.7 : 0}
        />
      </Group>
    );
  }
);

RobotMarker.displayName = 'RobotMarker';
