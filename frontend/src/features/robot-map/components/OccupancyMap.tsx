import { useEffect } from 'react';
import { useOccupancyMap } from '../hooks/useOccupancyMap';
import { MapStage } from './MapStage';
import type { Robot } from '@/types/robot';
import type { PathMessage, Pose2D, LaserScan } from '@/types/telemetry';
import type { ProcessedMapData } from '@tensrai/shared';

interface OccupancyMapProps {
  mapId: string;
  onMapChange?: (mapId: string) => void;
  enablePanning?: boolean;
  enableZooming?: boolean;
  width?: string | number;
  height?: string | number;
  className?: string;
  robots?: Robot[] | undefined;
  telemetryRobotId?: string | null;
  selectedRobotId?: string | null;
  telemetry?:
    | {
        pose?: Pose2D;
        laser?: LaserScan;
      path?: PathMessage;
    }
    | null
    | undefined;
  onRobotSelect?: ((robotId: string | null) => void) | undefined;
  onMapFeaturesChange?: (features: ProcessedMapData['features'] | undefined) => void;
  setPoseMode?: boolean;
  onPoseConfirm?: () => void;
  onPoseCancel?: () => void;
}

export function OccupancyMap({
  mapId,
  enablePanning = true,
  enableZooming = true,
  width = '100%',
  height = '100%',
  className,
  robots,
  telemetryRobotId,
  selectedRobotId,
  telemetry,
  onRobotSelect,
  onMapFeaturesChange,
  setPoseMode,
  onPoseConfirm,
  onPoseCancel,
}: OccupancyMapProps) {
  const mapState = useOccupancyMap({
    mapId,
    autoLoad: true,
    useOptimizedParser: true,
  });

  useEffect(() => {
    if (onMapFeaturesChange) {
      onMapFeaturesChange(mapState.data?.features);
    }
  }, [mapState.data?.features, onMapFeaturesChange]);

  if (!mapState.data && mapState.loading) {
    return (
      <div
        className={`flex items-center justify-center bg-muted ${className || ''}`}
        style={{ width, height }}
      >
        <div className="text-muted-foreground">Loading map...</div>
      </div>
    );
  }

  if (!mapState.data && mapState.error) {
    return (
      <div
        className={`flex items-center justify-center bg-muted ${className || ''}`}
        style={{ width, height }}
      >
        <div className="text-center">
          <div className="text-status-error mb-2">Failed to load map</div>
          <div className="text-sm text-muted-foreground">{mapState.error}</div>
        </div>
      </div>
    );
  }

  if (!mapState.data) {
    return (
      <div
        className={`flex items-center justify-center bg-muted ${className || ''}`}
        style={{ width, height }}
      >
        <div className="text-center space-y-2">
          <div className="text-muted-foreground">No map available</div>
          <div className="text-xs text-muted-foreground/80">Select a robot to load its map</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden ${className || ''}`} style={{ width, height }}>
      <MapStage
        mapData={mapState.data}
        width={width}
        height={height}
        enablePanning={enablePanning}
        enableZooming={enableZooming}
        robots={robots}
        telemetryRobotId={telemetryRobotId ?? undefined}
        selectedRobotId={selectedRobotId ?? undefined}
        telemetry={telemetry}
        onRobotSelect={onRobotSelect}
        setPoseMode={setPoseMode}
        onPoseConfirm={onPoseConfirm}
        onPoseCancel={onPoseCancel}
      />

      {mapState.loading && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-background/80 backdrop-blur-sm px-4 py-2 rounded-md shadow-sm text-sm text-muted-foreground border border-border">
            Loading map
          </div>
        </div>
      )}

      {mapState.error && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/80">
          <div className="text-center">
            <div className="text-status-error mb-2">Failed to load map</div>
            <div className="text-sm text-muted-foreground">{mapState.error}</div>
          </div>
        </div>
      )}
    </div>
  );
}
