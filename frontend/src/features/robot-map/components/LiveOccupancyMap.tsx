import type { ProcessedMapData } from '@tensrai/shared';
import { useMemo } from 'react';
import { useRobotTelemetry } from '@/hooks/useRobotTelemetry';
import type { Robot } from '@/types/robot';
import type { PoseConfirmPayload } from './Map/SetPoseLayer';
import { OccupancyMap } from './OccupancyMap';

type LiveOccupancyMapProps = {
  mapId: string;
  robots: Robot[];
  telemetryRobotId: string | null;
  selectedRobotId?: string | null;
  onMapChange?: (mapId: string) => void;
  onRobotSelect?: (robotId: string | null) => void;
  onMapFeaturesChange?: (features: ProcessedMapData['features'] | undefined) => void;
  setPoseMode?: boolean;
  onPoseConfirm?: (payload: PoseConfirmPayload) => void;
  onPoseCancel?: () => void;
  highlightTagIds?: string[];
  dimNonMissionTags?: boolean;
};

export function LiveOccupancyMap({
  mapId,
  robots,
  telemetryRobotId,
  selectedRobotId,
  onMapChange,
  onRobotSelect,
  onMapFeaturesChange,
  setPoseMode,
  onPoseConfirm,
  onPoseCancel,
  highlightTagIds,
  dimNonMissionTags,
}: LiveOccupancyMapProps) {
  const { telemetry } = useRobotTelemetry(telemetryRobotId);
  const livePose = telemetry?.pose;

  const robotsWithLivePose = useMemo(() => {
    if (
      !telemetryRobotId ||
      !livePose ||
      !Number.isFinite(livePose.x) ||
      !Number.isFinite(livePose.y) ||
      !Number.isFinite(livePose.theta)
    ) {
      return robots;
    }

    return robots.map(robot =>
      robot.id === telemetryRobotId
        ? {
            ...robot,
            x: livePose.x,
            y: livePose.y,
            theta: livePose.theta,
          }
        : robot
    );
  }, [livePose, robots, telemetryRobotId]);

  return (
    <OccupancyMap
      mapId={mapId}
      width="100%"
      height="100%"
      enablePanning={true}
      enableZooming={true}
      robots={robotsWithLivePose}
      {...(telemetryRobotId ? { telemetryRobotId } : {})}
      {...(telemetry ? { telemetry } : {})}
      {...(selectedRobotId !== undefined ? { selectedRobotId } : {})}
      {...(onMapChange ? { onMapChange } : {})}
      {...(onRobotSelect ? { onRobotSelect } : {})}
      {...(onMapFeaturesChange ? { onMapFeaturesChange } : {})}
      {...(setPoseMode !== undefined ? { setPoseMode } : {})}
      {...(onPoseConfirm ? { onPoseConfirm } : {})}
      {...(onPoseCancel ? { onPoseCancel } : {})}
      {...(highlightTagIds ? { highlightTagIds } : {})}
      {...(dimNonMissionTags !== undefined ? { dimNonMissionTags } : {})}
    />
  );
}
