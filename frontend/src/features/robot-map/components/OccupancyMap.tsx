import { useOccupancyMap } from '../hooks/useOccupancyMap';
import { MapStage } from './MapStage';

interface OccupancyMapProps {
  mapId: string;
  onMapChange?: (mapId: string) => void;
  enablePanning?: boolean;
  enableZooming?: boolean;
  width?: string | number;
  height?: string | number;
  className?: string;
}

export function OccupancyMap({
  mapId,
  enablePanning = true,
  enableZooming = true,
  width = '100%',
  height = '100%',
  className,
}: OccupancyMapProps) {
  const mapState = useOccupancyMap({
    mapId,
    autoLoad: true,
    useOptimizedParser: true,
  });

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
