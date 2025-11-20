/**
 * Robot Map Feature Module
 * Exports all components and utilities for ROS map rendering (Phase 1) and multi-map architecture (Phase 2)
 */

export { MapErrorBoundary } from './components/MapErrorBoundary';
export { MapStage } from './components/MapStage';
export { MultiMapStage } from './components/MultiMapStage';
export { MULTI_MAP_PRESETS, MultiMapView } from './components/MultiMapView';
export { OccupancyMap } from './components/OccupancyMap';
export { RobotLegend, RobotOverlay, RobotSelector } from './components/RobotOverlay';
export {
  useMapManager,
  useMultiMapManager,
  useRobotAssignments as useRobotAssignmentManager,
} from './hooks/useMultiMapManager';
export { useMapCache, useOccupancyMap } from './hooks/useOccupancyMap';
export { positionSynchronizer, usePositionSynchronizer } from './services/positionSynchronizer';
export {
  useActiveMap,
  useMapAnalytics,
  useMapLayers,
  useMaps,
  useMultiMapStore,
  useRobotAssignments,
} from './stores/useMultiMapStore';
export type { MapDebugInfo, MapStageProps } from './types';
export type {
  AlertFilters,
  AlertRule,
  AlertStats,
  AlertSystemActions,
  AlertSystemState,
  AlertSystemStore,
  RobotAlert,
} from './types/alerts';
export type {
  CallResult,
  CircuitBreakerConfig,
  CircuitBreakerState,
  CircuitState,
  CircuitStats,
} from './types/circuit-breaker';
export type {
  ErrorInfo,
  ErrorRule,
  ErrorStats,
} from './types/errors';
export type {
  MemoryManagerConfig,
  MemoryStats,
  ResourceTracker,
} from './types/memory';
export type {
  MapAssignment,
  MapRegistrationConfig,
  MapRegistryEntry,
  MapSyncEvent,
  MultiMapActions,
  MultiMapAnalytics,
  MultiMapError,
  MultiMapState,
  MultiMapViewportConfig,
} from './types/multi-map';
export type {
  BatchedOperation,
  PerformanceConfig,
  PerformanceStats,
} from './types/performance';
export type {
  PositionUpdate,
  RobotTrajectory,
  TrajectoryPoint,
} from './types/position';
export type {
  RollbackConfig,
  RollbackStats,
  Snapshot,
} from './types/rollback';
export type {
  SyncConfig,
  SyncOperation,
  SyncStats,
} from './types/sync';
export type {
  RobotTelemetry,
  TelemetryActions,
  TelemetryAggregation,
  TelemetryAlert,
  TelemetryState,
  TelemetryStore,
} from './types/telemetry';
export { syncManager, useMapSynchronization } from './utils/mapSynchronization';
