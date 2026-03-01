import { Shape } from 'react-konva';

interface LaserLayerProps {
  points: Float32Array;
  scale?: number;
}

export function LaserLayer({ points, scale = 1 }: LaserLayerProps) {
  // Make laser points visually larger; 1.7x the previous baseline.
  const baseRadius = 2 * 1.7;
  const radius = Math.max(0.75, baseRadius / Math.max(scale, 0.001));

  if (points.length < 2) return null;

  return (
    <Shape
      listening={false}
      perfectDrawEnabled={false}
      sceneFunc={ctx => {
        ctx.save();
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = '#ef4444';
        for (let index = 0; index < points.length; index += 2) {
          const x = points[index] ?? 0;
          const y = points[index + 1] ?? 0;
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }}
    />
  );
}
