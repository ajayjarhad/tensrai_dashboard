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
        strokeWidth={3}
        lineCap="round"
        lineJoin="round"
        opacity={0.8}
        // Longer dash/gap for a clearly dotted appearance, works better across zoom levels.
        lineDash={[12, 10]}
      />
    </Group>
  );
}
