/**
 * Occupancy Map Component
 * Combines map loading and rendering in a single convenient component
 */

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
   * Whether to show coordinate debug overlay
   * @default false
   */
  showDebugOverlay?: boolean;

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
   * Callback for coordinate display
   */
  onCoordinateChange?: (worldCoords: { x: number; y: number } | null) => void;

  /**
   * CSS class name
   */
  className?: string;
}

export function OccupancyMap({
  mapYamlPath,
  initialZoom,
  enablePanning,
  enableZooming,
  showDebugOverlay,
  width,
  height,
  onCoordinateChange,
  className,
}: OccupancyMapProps) {
  const { data, loading, error, reload } = useOccupancyMap({
    mapYamlPath,
    autoLoad: true,
  });

  if (loading) {
    return (
      <div className={`flex items-center justify-center h-full ${className || ''}`}>
        <div className="text-gray-500">Loading map...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex flex-col items-center justify-center h-full ${className || ''}`}>
        <div className="text-red-500 mb-4">Error loading map: {error}</div>
        <button
          type="button"
          onClick={reload}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={`flex items-center justify-center h-full ${className || ''}`}>
        <div className="text-gray-500">No map data available</div>
      </div>
    );
  }

  return (
    <MapStage
      mapData={data}
      initialZoom={initialZoom ?? 1.0}
      enablePanning={enablePanning ?? true}
      enableZooming={enableZooming ?? true}
      showDebugOverlay={showDebugOverlay ?? false}
      width={width ?? '100%'}
      height={height ?? '100%'}
      onCoordinateChange={onCoordinateChange || null}
      className={className || ''}
    />
  );
}
