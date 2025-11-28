import type Konva from 'konva';
import { forwardRef } from 'react';
import { Circle, Group, Path } from 'react-konva';

interface LocationPinProps {
  x: number;
  y: number;
  rotation?: number;
  scale?: number;
  color?: string;
  name?: string;
  onClick?: (evt: Konva.KonvaEventObject<MouseEvent>) => void;
  onTap?: (evt: Konva.KonvaEventObject<MouseEvent>) => void;
}

export const LocationPin = forwardRef<Konva.Group, LocationPinProps>(
  ({ x, y, rotation = 0, scale = 1, color = '#01FF01', name, onClick, onTap }, ref) => {
    const pathScale = 2.2;
    const pathData =
      'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z';

    return (
      <Group
        ref={ref as any}
        x={x}
        y={y}
        rotation={rotation}
        scaleX={scale}
        scaleY={scale}
        name={name}
        {...(onClick ? { onClick } : {})}
        {...(onTap ? { onTap } : {})}
      >
        {/* Invisible hit area to make the pin easy to click, including the hollow center */}
        <Circle x={0} y={0} radius={16 * pathScale} fill="#000" opacity={0.01} listening />
        <Path
          data={pathData}
          fill={color}
          stroke="black"
          strokeWidth={0.65}
          scaleX={pathScale}
          scaleY={pathScale}
          rotation={-90}
          offsetX={12}
          offsetY={9}
          shadowColor="black"
          shadowBlur={5}
          shadowOpacity={0.3}
          shadowOffset={{ x: 2, y: 2 }}
        />
      </Group>
    );
  }
);

LocationPin.displayName = 'LocationPin';
