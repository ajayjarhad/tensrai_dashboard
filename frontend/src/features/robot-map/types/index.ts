/**
 * Robot Map Feature Types
 * Feature-specific type definitions and interfaces
 */

export interface MapStageProps {
  /**
   * Processed map data to render
   */
  mapData: import('@tensrai/shared').ProcessedMapData | null;

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
  onCoordinateChange: ((worldCoords: { x: number; y: number } | null) => void) | null;

  /**
   * CSS class name
   */
  className: string | null;
}

export interface MapDebugInfo {
  worldCoords: { x: number; y: number } | null;
  canvasCoords: { x: number; y: number } | null;
  pixelCoords: { x: number; y: number } | null;
  zoom: number;
  pan: { x: number; y: number };
}

export type {
  AlertFilters,
  AlertRule,
  AlertStats,
  AlertSystemActions,
  AlertSystemState,
  AlertSystemStore,
  RobotAlert,
} from './alerts';
export type {
  CallResult,
  CircuitBreakerConfig,
  CircuitBreakerState,
  CircuitState,
  CircuitStats,
} from './circuit-breaker';
export type { ErrorInfo, ErrorRule, ErrorStats } from './errors';
export type { MemoryManagerConfig, MemoryStats, ResourceTracker } from './memory';
export type { BatchedOperation, PerformanceConfig, PerformanceStats } from './performance';
export type { PositionUpdate, RobotTrajectory, TrajectoryPoint } from './position';
export type { RollbackConfig, RollbackStats, Snapshot } from './rollback';
// Service Type Exports
export type { SyncConfig, SyncOperation, SyncStats } from './sync';
export type {
  RobotTelemetry,
  TelemetryActions,
  TelemetryAggregation,
  TelemetryAlert,
  TelemetryState,
  TelemetryStore,
} from './telemetry';
