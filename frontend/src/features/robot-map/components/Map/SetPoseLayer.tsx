import type { PixelPoint } from '@tensrai/shared';
import type Konva from 'konva';
import { useCallback, useMemo } from 'react';
import { Circle, Group, Layer, Line, Rect, Text } from 'react-konva';
import type { MapTransforms } from '@/lib/map/mapTransforms';
import { mapPixelToWorld, worldAngle } from '@/lib/map/mapTransforms';
import { RobotMode } from '@/types/robot';
import type { TempLocation } from '../../hooks/useMapLocations';
import { RobotMarker } from '../RobotMarker';

export type PendingPose =
  | {
      source: 'location';
      location: TempLocation;
      pixel: PixelPoint;
      theta: number;
      showConfirm: true;
    }
  | {
      source: 'manual';
      pixel: PixelPoint;
      theta: number;
      showConfirm: boolean;
    };

export type PoseConfirmPayload = {
  x: number;
  y: number;
  theta: number;
  source: 'location' | 'manual';
  locationId?: string;
  locationName?: string;
};

interface SetPoseLayerProps {
  pendingPose: PendingPose | null;
  setPendingPose: React.Dispatch<React.SetStateAction<PendingPose | null>>;
  transforms: MapTransforms | null;
  resolution: number;
  onPoseConfirm: (payload: PoseConfirmPayload) => void;
  onPoseCancel: () => void;
  pointerToMapPixel: () => PixelPoint | null;
}

export function SetPoseLayer({
  pendingPose,
  setPendingPose,
  transforms,
  resolution,
  onPoseConfirm,
  onPoseCancel,
  pointerToMapPixel,
}: SetPoseLayerProps) {
  const ROBOT_WIDTH_METERS = 1.1;
  const ROBOT_LENGTH_METERS = 1.6;
  const robotLengthPixels = ROBOT_LENGTH_METERS / resolution;

  const cancelPose = useCallback(() => {
    setPendingPose(null);
    onPoseCancel();
  }, [onPoseCancel, setPendingPose]);

  const confirmPose = useCallback(() => {
    if (!pendingPose || !transforms) return;
    const worldPoint = mapPixelToWorld(pendingPose.pixel, transforms);
    const theta = pendingPose.theta ?? 0;

    onPoseConfirm({
      x: worldPoint.x,
      y: worldPoint.y,
      theta,
      source: pendingPose.source,
      ...(pendingPose.source === 'location' && pendingPose.location.id
        ? { locationId: pendingPose.location.id }
        : {}),
      ...(pendingPose.source === 'location' && pendingPose.location.name
        ? { locationName: pendingPose.location.name }
        : {}),
    });
    setPendingPose(null);
  }, [onPoseConfirm, pendingPose, transforms, setPendingPose]);

  const updateRotationFromPointer = useCallback(
    (pixelPoint: PixelPoint) => {
      if (!transforms) return;
      setPendingPose(prev => {
        if (!prev || prev.source !== 'manual') return prev;
        const centerWorld = mapPixelToWorld(prev.pixel, transforms);
        const pointerWorld = mapPixelToWorld(pixelPoint, transforms);
        const theta = worldAngle(centerWorld, pointerWorld);
        return { ...prev, theta };
      });
    },
    [transforms, setPendingPose]
  );

  const pendingRotationDegrees =
    pendingPose && pendingPose.source === 'manual' ? 90 - (pendingPose.theta * 180) / Math.PI : 90;

  const handleRadius = robotLengthPixels + 18;
  const handleOffset = useMemo(() => {
    if (!pendingPose || pendingPose.source !== 'manual') {
      return { x: 0, y: -handleRadius };
    }
    const rad = ((pendingRotationDegrees - 90) * Math.PI) / 180;
    return {
      x: handleRadius * Math.cos(rad),
      y: handleRadius * Math.sin(rad),
    };
  }, [handleRadius, pendingPose, pendingRotationDegrees]);

  const handleRotationDrag = useCallback(
    (evt: Konva.KonvaEventObject<MouseEvent>) => {
      const pixel = pointerToMapPixel();
      if (pixel) {
        updateRotationFromPointer(pixel);
      }
      if (evt?.target?.position) {
        evt.target.position({ x: handleOffset.x, y: handleOffset.y });
      }
    },
    [handleOffset.x, handleOffset.y, pointerToMapPixel, updateRotationFromPointer]
  );

  if (!pendingPose) return null;

  return (
    <Layer listening>
      <Group
        x={pendingPose.pixel.x}
        y={pendingPose.pixel.y}
        opacity={0.95}
        onClick={evt => {
          evt.cancelBubble = true;
        }}
        onTap={evt => {
          evt.cancelBubble = true;
        }}
        onMouseDown={evt => {
          evt.cancelBubble = true;
        }}
      >
        {pendingPose.source === 'manual' && (
          <>
            <Circle
              radius={handleRadius}
              stroke="#22c55e"
              strokeWidth={1}
              dash={[6, 6]}
              opacity={0.55}
              listening={false}
            />
            <Line
              points={[0, 0, handleOffset.x, handleOffset.y]}
              stroke="#22c55e"
              strokeWidth={2}
              opacity={0.8}
              listening={false}
            />
            <RobotMarker
              x={0}
              y={0}
              rotation={pendingRotationDegrees}
              status={RobotMode.UNKNOWN}
              widthMeters={ROBOT_WIDTH_METERS}
              lengthMeters={ROBOT_LENGTH_METERS}
              resolution={resolution}
            />

            <Group
              x={handleOffset.x}
              y={handleOffset.y}
              draggable
              dragBoundFunc={() => ({ x: handleOffset.x, y: handleOffset.y })}
              onDragMove={handleRotationDrag}
              onDragEnd={handleRotationDrag}
              onMouseDown={evt => {
                evt.cancelBubble = true;
              }}
              onTap={evt => {
                evt.cancelBubble = true;
              }}
            >
              <Circle
                radius={10}
                fill="#22c55e"
                stroke="#16a34a"
                strokeWidth={2}
                shadowColor="black"
                shadowBlur={4}
                shadowOpacity={0.22}
                shadowOffset={{ x: 1, y: 2 }}
              />
              <Text
                text="⟳"
                fontSize={10}
                fontFamily="Inter, system-ui, -apple-system, sans-serif"
                fill="#0f172a"
                offsetX={4}
                offsetY={6}
              />
            </Group>
          </>
        )}

        {(pendingPose.source === 'location' || pendingPose.showConfirm) && (
          <Group
            y={pendingPose.source === 'manual' ? -robotLengthPixels / 2 - 125 : -90}
            offsetX={120}
          >
            <Rect
              width={240}
              height={pendingPose.source === 'manual' ? 132 : 118}
              fill="rgba(15, 23, 42, 0.9)"
              cornerRadius={12}
              shadowColor="black"
              shadowBlur={10}
              shadowOpacity={0.3}
              shadowOffset={{ x: 2, y: 3 }}
            />
            <Text
              x={16}
              y={18}
              width={208}
              wrap="word"
              lineHeight={1.25}
              align="left"
              text={
                pendingPose.source === 'location'
                  ? `Use ${pendingPose.location.name || 'location'}`
                  : 'Robot will have this pose'
              }
              fontSize={14}
              fill="#ffffff"
              fontStyle="bold"
              fontFamily="Inter, system-ui, -apple-system, sans-serif"
            />
            <Group
              x={16}
              y={pendingPose.source === 'manual' ? 76 : 66}
              onClick={evt => {
                evt.cancelBubble = true;
                confirmPose();
              }}
              onTap={evt => {
                evt.cancelBubble = true;
                confirmPose();
              }}
            >
              <Rect width={96} height={36} fill="#22c55e" cornerRadius={8} />
              <Text
                x={16}
                y={11}
                text="Confirm"
                fontSize={12}
                fill="#0f172a"
                fontFamily="Inter, system-ui, -apple-system, sans-serif"
              />
            </Group>
            <Group
              x={124}
              y={pendingPose.source === 'manual' ? 76 : 66}
              onClick={evt => {
                evt.cancelBubble = true;
                cancelPose();
              }}
              onTap={evt => {
                evt.cancelBubble = true;
                cancelPose();
              }}
            >
              <Rect width={96} height={36} fill="#1f2937" cornerRadius={8} stroke="#334155" />
              <Text
                x={18}
                y={11}
                text="Cancel"
                fontSize={12}
                fill="#e2e8f0"
                fontFamily="Inter, system-ui, -apple-system, sans-serif"
              />
            </Group>
          </Group>
        )}
      </Group>
    </Layer>
  );
}
