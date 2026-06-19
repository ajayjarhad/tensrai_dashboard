import type { ProcessedMapData } from '@tensrai/shared';
import { useEffect } from 'react';
import type { Robot } from '@/types/robot';
import type { LaserScan, PathMessage, Pose2D } from '@/types/telemetry';
import { useOccupancyMap } from '../hooks/useOccupancyMap';
import type { PoseConfirmPayload } from './Map/SetPoseLayer';
import { MapStage } from './MapStage';

const phaseLabel = {
  'checking-cache': 'Checking cached map',
  'fetching-metadata': 'Fetching map metadata',
  'downloading-display': 'Downloading map display',
  'downloading-pgm-fallback': 'Downloading raw map fallback',
  decoding: 'Decoding map',
  ready: 'Map ready',
  failed: 'Failed to load map',
} as const;

const formatBytes = (bytes?: number) => {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

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
  onPoseConfirm?: (payload: PoseConfirmPayload) => void;
  onPoseCancel?: () => void;
  highlightTagIds?: string[];
  dimNonMissionTags?: boolean;
}

export function OccupancyMap({
  mapId,
  onMapChange,
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
  highlightTagIds,
  dimNonMissionTags,
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

  useEffect(() => {
    onMapChange?.(mapId);
  }, [mapId, onMapChange]);

  return (
    <div className={`relative ${className || ''}`} style={{ width, height }}>
      {renderMapContent()}
      {mapState.loading && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-[min(24rem,calc(100%-2rem))] bg-background/90 backdrop-blur-sm px-4 py-3 rounded-md shadow-sm text-sm text-muted-foreground border border-border">
            <div className="flex items-center justify-between gap-3">
              <span>{phaseLabel[mapState.progress?.phase ?? 'fetching-metadata']}</span>
              {typeof mapState.progress?.progress === 'number' && (
                <span>{Math.round(mapState.progress.progress)}%</span>
              )}
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{
                  width:
                    typeof mapState.progress?.progress === 'number'
                      ? `${Math.max(5, Math.min(100, mapState.progress.progress))}%`
                      : '35%',
                }}
              />
            </div>
            {mapState.progress?.bytesReceived ? (
              <div className="mt-2 text-xs">
                {formatBytes(mapState.progress.bytesReceived)}
                {mapState.progress.totalBytes
                  ? ` of ${formatBytes(mapState.progress.totalBytes)}`
                  : ' downloaded'}
              </div>
            ) : null}
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

  function renderMapContent() {
    if (!mapState.data) {
      return renderNoMapContent();
    }

    return (
      <div className="relative overflow-hidden w-full h-full">
        <MapStage
          mapData={mapState.data}
          width={width}
          height={height}
          enablePanning={enablePanning}
          enableZooming={enableZooming}
          robots={robots}
          telemetryRobotId={telemetryRobotId ?? undefined}
          selectedRobotId={selectedRobotId ?? null}
          telemetry={telemetry}
          onRobotSelect={onRobotSelect}
          setPoseMode={setPoseMode ?? false}
          onPoseConfirm={onPoseConfirm || ((_payload: PoseConfirmPayload) => {})}
          onPoseCancel={onPoseCancel || (() => {})}
          {...(highlightTagIds ? { highlightTagIds } : {})}
          {...(dimNonMissionTags !== undefined ? { dimNonMissionTags } : {})}
        />
      </div>
    );
  }

  function renderNoMapContent() {
    if (mapState.loading) {
      return (
        <div className="flex items-center justify-center bg-muted w-full h-full">
          <div className="text-muted-foreground">Loading map...</div>
        </div>
      );
    }

    if (mapState.error) {
      return (
        <div className="flex items-center justify-center bg-muted w-full h-full">
          <div className="text-center">
            <div className="text-status-error mb-2">Failed to load map</div>
            <div className="text-sm text-muted-foreground">{mapState.error}</div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex items-center justify-center bg-muted w-full h-full">
        <div className="text-center space-y-2">
          <div className="text-muted-foreground">No map available</div>
          <div className="text-xs text-muted-foreground/80">Select a robot to load its map</div>
        </div>
      </div>
    );
  }
}
