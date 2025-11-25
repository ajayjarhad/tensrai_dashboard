import { Group, Line } from 'react-konva';
import type { PixelPoint } from '@tensrai/shared';

interface PathLayerProps {
  points: PixelPoint[];
}

export function PathLayer({ points }: PathLayerProps) {
  if (!points.length) return null;

  const flattened = points.flatMap(p => [p.x, p.y]);

  return (
    <Group listening={false}>
      <Line
        points={flattened}
        stroke="#3b82f6"
        strokeWidth={2}
        lineCap="round"
        lineJoin="round"
        opacity={0.8}
      />
    </Group>
  );
}
