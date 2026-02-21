import type { PixelPoint } from '@tensrai/shared';
import { Shape } from 'react-konva';

interface LaserLayerProps {
  points: PixelPoint[];
  scale?: number;
}

const MAX_RENDER_POINTS = 450;

export function LaserLayer({ points, scale = 1 }: LaserLayerProps) {
  // Make laser points visually larger; 1.7x the previous baseline.
  const baseRadius = 2 * 1.7;
  const radius = Math.max(0.75, baseRadius / Math.max(scale, 0.001));
  const pointSize = Math.max(1, radius * 2);
  const sampledPoints = (() => {
    if (points.length <= MAX_RENDER_POINTS) return points;
    const stride = Math.ceil(points.length / MAX_RENDER_POINTS);
    const reduced: PixelPoint[] = [];
    for (let i = 0; i < points.length; i += stride) {
      reduced.push(points[i]);
    }
    return reduced;
  })();

  if (!sampledPoints.length) return null;

  return (
    <Shape
      listening={false}
      perfectDrawEnabled={false}
      sceneFunc={ctx => {
        ctx.save();
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = '#ef4444';
        for (let i = 0; i < sampledPoints.length; i += 1) {
          const point = sampledPoints[i];
          ctx.fillRect(point.x - radius, point.y - radius, pointSize, pointSize);
        }
        ctx.restore();
      }}
    />
  );
}
