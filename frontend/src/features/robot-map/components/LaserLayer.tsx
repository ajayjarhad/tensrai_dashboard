import { Circle, Group } from 'react-konva';
import type { PixelPoint } from '@tensrai/shared';

interface LaserLayerProps {
  points: PixelPoint[];
  scale?: number;
}

export function LaserLayer({ points, scale = 1 }: LaserLayerProps) {
  if (!points.length) return null;

  // Make laser points visually larger; 1.7x the previous baseline.
  const baseRadius = 2 * 1.7;
  const radius = Math.max(0.75, baseRadius / Math.max(scale, 0.001));

  if (typeof console !== 'undefined') {
    console.log('[LaserLayer] rendering points count', points.length);
    if (points.length > 0) {
      console.log('[LaserLayer] first point', points[0]);
    }
  }

  return (
    <Group listening={false}>
      {points.map((p, idx) => (
        <Circle
          key={`laser-${idx}`}
          x={p.x}
          y={p.y}
          radius={radius}
          fill="#ef4444"
          opacity={0.8}
        />
      ))}
    </Group>
  );
}
