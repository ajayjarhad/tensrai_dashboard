import { useOccupancyMap } from '../hooks/useOccupancyMap';
import { MapStage } from './MapStage';

interface OccupancyMapProps {
  /**
   * Path to the map YAML file
   */
  mapYamlPath: string;

  /**
   * Initial zoom level
   * @default 1.0
   */
  initialZoom?: number;

  /**
   * Whether to enable panning with mouse drag
   * @default true
   */
  enablePanning?: boolean;

  /**
   * Whether to enable zooming with mouse wheel
   * @default true
   */
  enableZooming?: boolean;

  /**
   * Width of the stage
   * @default '100%'
   */
  width?: string | number;

  /**
   * Height of the stage
   * @default '100%'
   */
  height?: string | number;

  /**
   * CSS class name
   */
  className?: string;
}

export function OccupancyMap({
  mapYamlPath,
  initialZoom = 1.0,
  enablePanning = true,
  enableZooming = true,
  width = '100%',
  height = '100%',
  className,
}: OccupancyMapProps) {
  const mapState = useOccupancyMap({
    mapYamlPath,
    autoLoad: true,
    useOptimizedParser: true,
  });

  if (mapState.loading) {
    return (
      <div
        className={`flex items-center justify-center bg-gray-100 ${className || ''}`}
        style={{ width, height }}
      >
        <div className="text-gray-500">Loading map...</div>
      </div>
    );
  }

  if (mapState.error) {
    return (
      <div
        className={`flex items-center justify-center bg-gray-100 ${className || ''}`}
        style={{ width, height }}
      >
        <div className="text-center">
          <div className="text-red-500 mb-2">Failed to load map</div>
          <div className="text-sm text-gray-400">{mapState.error}</div>
        </div>
      </div>
    );
  }

  return (
    <MapStage
      mapData={mapState.data}
      width={width}
      height={height}
      className={className || ''}
      enablePanning={enablePanning}
      enableZooming={enableZooming}
    />
  );
}
