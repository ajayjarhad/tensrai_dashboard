/**
 * Multi-Map Architecture Types
 * Defines the data structures for managing multiple maps and robot assignments
 */

import type {
  MapLayer,
  ProcessedMapData,
  ROSPoseStamped,
  RobotFrame,
  RobotInfo,
  WorldPoint,
} from '@tensrai/shared';

/**
 * Map Assignment - Links robots to specific maps
 */
export interface MapAssignment {
  robotId: string;
  mapId: string;
  assignedAt: Date;
  assignedBy: string; // User or system assignment
  status: 'active' | 'inactive' | 'transferring';
}

/**
 * Map Registry Entry - Complete map information
 */
export interface MapRegistryEntry {
  mapId: string;
  name: string;
  description?: string;
  yamlPath: string;
  data: ProcessedMapData | null; // Loaded map data
  metadata: {
    width: number;
    height: number;
    resolution: number;
    origin: [number, number, number];
    bounds: {
      min: WorldPoint;
      max: WorldPoint;
    };
  };
  assignedRobots: Set<string>; // robot IDs
  loadStatus: 'unloaded' | 'loading' | 'loaded' | 'error';
  loadError: string; // Required field, initialized to empty string
  lastAccessed: Date;
  accessCount: number;
}

/**
 * Viewport State
 */
export interface ViewportState {
  mapId: string;
  center: WorldPoint;
  zoom: number;
  rotation: number;
}

/**
 * Multi-Map State Structure
 */
export interface MultiMapState {
  // Map Management
  maps: Map<string, MapRegistryEntry>;
  assignments: Map<string, MapAssignment>; // robotId -> assignment

  // Active Map Selection
  activeMapId: string | null;
  focusedRobotId: string | null;

  // Layer Management
  layers: Map<string, MapLayer>;
  layerOrder: string[];

  // Robot Management
  robots: Map<string, RobotInfo>;
  robotFrames: Map<string, RobotFrame>;

  // Viewport State
  viewports: Map<string, ViewportState>;

  // Global Settings
  settings: {
    maxLoadedMaps: number;
    autoLoadMaps: boolean;
    trackRobotPositions: boolean;
    showInactiveRobots: boolean;
  };

  // System State
  isInitialized: boolean;
  lastSync: Date | null;
}

/**
 * Multi-Map Store Actions
 */
export interface MultiMapActions {
  // Map Management
  registerMap: (mapId: string, config: MapRegistrationConfig) => void;
  unregisterMap: (mapId: string) => void;
  loadMap: (mapId: string) => Promise<void>;
  unloadMap: (mapId: string) => void;

  // Robot Assignment
  assignRobotToMap: (robotId: string, mapId: string, assignedBy?: string) => void;
  unassignRobot: (robotId: string) => void;
  transferRobot: (robotId: string, newMapId: string) => void;

  // Active Map Management
  setActiveMap: (mapId: string | null) => void;
  focusRobot: (robotId: string | null) => void;

  // Layer Management
  addLayer: (layer: MapLayer) => void;
  removeLayer: (layerId: string) => void;
  updateLayer: (layerId: string, updates: Partial<MapLayer>) => void;
  reorderLayers: (layerIds: string[]) => void;

  // Robot Updates
  updateRobot: (robotId: string, updates: Partial<RobotInfo>) => void;
  updateRobotPose: (robotId: string, pose: ROSPoseStamped) => void;
  removeRobot: (robotId: string) => void;

  // Viewport Management
  updateViewport: (mapId: string, viewport: Partial<ViewportState>) => void;

  // Settings
  updateSettings: (settings: Partial<MultiMapState['settings']>) => void;

  // Utility
  clearAllMaps: () => void;
  syncAssignments: () => void;
}

/**
 * Map Registration Configuration
 */
export interface MapRegistrationConfig {
  name: string;
  description?: string;
  yamlPath: string;
  preload?: boolean;
}

/**
 * Map Assignment History
 */
export interface MapAssignmentHistory {
  robotId: string;
  mapId: string;
  assignedAt: Date;
  assignedBy: string;
  unassignedAt?: Date;
  reason?: string;
}

/**
 * Multi-Map Analytics
 */
export interface MultiMapAnalytics {
  totalMaps: number;
  loadedMaps: number;
  totalRobots: number;
  activeRobots: number;
  mapUtilization: Map<string, number>; // mapId -> robot count
  mostActiveMap?: string;
  robotStatusCounts: {
    online: number;
    offline: number;
    error: number;
  };
  lastUpdated: Date;
}

/**
 * Map Synchronization Events
 */
export interface MapSyncEvent {
  type:
    | 'map_registered'
    | 'map_unregistered'
    | 'map_loaded'
    | 'map_unloaded'
    | 'robot_assigned'
    | 'robot_unassigned'
    | 'robot_transferred'
    | 'layer_added'
    | 'layer_removed'
    | 'layer_updated'
    | 'pose_updated';
  mapId?: string;
  robotId?: string;
  layerId?: string;
  timestamp: Date;
  data?: any;
}

/**
 * Multi-Map Viewport Configuration
 */
export interface MultiMapViewportConfig {
  mode: 'single' | 'split' | 'picture-in-picture';
  layout?: 'horizontal' | 'vertical' | 'grid';
  primaryMapId?: string | undefined;
  secondaryMapIds?: string[];
  syncZoom?: boolean;
  syncPan?: boolean;
  showCrosshairs?: boolean;
}

// Layer types are now defined in @tensrai/shared to avoid duplication

/**
 * Multi-Map Error Types
 */
export interface MultiMapError {
  type: 'map_load_error' | 'assignment_error' | 'sync_error' | 'viewport_error';
  mapId?: string;
  robotId?: string;
  message: string;
  timestamp: Date;
  recoverable: boolean;
}
