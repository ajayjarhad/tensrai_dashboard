import React, { useCallback, useSyncExternalStore } from 'react';
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
  if (status === RobotMode.AUTONOMOUS) {
    return '#64748B';
  }
  if (status === RobotMode.CHARGING || status === RobotMode.DOCKING) {
    return '#0EA5E9';
  }
  return '#94A3B8';
};

const PULSE_INTERVAL_MS = 90;
const pulseListeners = new Set<() => void>();
let pulseTimer: number | null = null;
let pulsePhase = 0;

const emitPulsePhase = () => {
  pulsePhase += 1;
  for (const listener of pulseListeners) {
    listener();
  }
};

const ensurePulseTimer = () => {
  if (pulseTimer !== null || pulseListeners.size === 0) return;
  pulseTimer = window.setInterval(emitPulsePhase, PULSE_INTERVAL_MS);
};

const teardownPulseTimer = () => {
  if (pulseListeners.size > 0 || pulseTimer === null) return;
  window.clearInterval(pulseTimer);
  pulseTimer = null;
  pulsePhase = 0;
};

const subscribePulse = (listener: () => void) => {
  pulseListeners.add(listener);
  ensurePulseTimer();
  return () => {
    pulseListeners.delete(listener);
    teardownPulseTimer();
  };
};

const getPulseSnapshot = () => pulsePhase;

const useSharedPulsePhase = (enabled: boolean) => {
  const subscribe = useCallback(
    (listener: () => void) => (enabled ? subscribePulse(listener) : () => {}),
    [enabled]
  );
  const getSnapshot = useCallback(() => (enabled ? getPulseSnapshot() : 0), [enabled]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};

export const RobotMarker = React.memo(
  ({ x, y, rotation, status, widthMeters, lengthMeters, resolution }: RobotMarkerProps) => {
    const widthPixels = widthMeters / resolution;
    const lengthPixels = lengthMeters / resolution;
    const indicatorColor = markerColorForStatus(status);
    const isEmergency = status === RobotMode.HW_EMERGENCY || status === RobotMode.SW_EMERGENCY;
    const sharedPulsePhase = useSharedPulsePhase(isEmergency);

    const pulseOpacity = isEmergency ? 0.6 + (Math.sin(sharedPulsePhase * 0.45) + 1) * 0.2 : 1;
    const pulseScale = isEmergency ? 1 + (Math.sin(sharedPulsePhase * 0.45) + 1) * 0.06 : 1;

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
