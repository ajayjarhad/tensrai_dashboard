import { Shape } from 'react-konva';

interface PathLayerProps {
  points: Float32Array;
}

export function PathLayer({ points }: PathLayerProps) {
  if (points.length < 4) return null;

  return (
    <Shape
      listening={false}
      perfectDrawEnabled={false}
      sceneFunc={ctx => {
        ctx.save();
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.setLineDash([12, 10]);
        ctx.beginPath();
        ctx.moveTo(points[0] ?? 0, points[1] ?? 0);
        for (let index = 2; index < points.length; index += 2) {
          ctx.lineTo(points[index] ?? 0, points[index + 1] ?? 0);
        }
        ctx.stroke();
        ctx.restore();
      }}
    />
  );
}
