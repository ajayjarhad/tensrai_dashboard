/**
 * ROS Occupancy Grid Map Message Types
 * Based on ROS nav_msgs/OccupancyGrid and geometry_msgs
 */

export interface ROSHeader {
  seq?: number;
  stamp: {
    sec?: number;
    nanosec?: number;
    secs?: number;
    nsecs?: number;
  };
  frame_id: string;
}

export interface ROSTime {
  secs: number;
  nsecs: number;
}

export interface ROSPose {
  position: {
    x: number;
    y: number;
    z: number;
  };
  orientation: {
    x: number;
    y: number;
    z: number;
    w: number;
  };
}

export interface ROSQuaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

// geometry_msgs/PoseWithCovariance
export interface ROSPoseWithCovariance {
  pose: ROSPose;
  covariance: number[]; // 36-length row-major 6x6 covariance
}

// geometry_msgs/PoseWithCovarianceStamped
export interface ROSPoseWithCovarianceStamped {
  header: ROSHeader;
  pose: ROSPoseWithCovariance;
}

export interface ROSPoint {
  x: number;
  y: number;
  z: number;
}

export interface ROSPoseStamped {
  header: ROSHeader;
  pose: ROSPose;
}

export interface ROSMapMetaData {
  map_load_time: ROSTime;
  resolution: number;
  width: number;
  height: number;
  origin: ROSPose;
}

export interface ROSOccupancyGrid {
  header: ROSHeader;
  info: ROSMapMetaData;
  data: Int8Array;
}

/**
 * YAML Map Metadata (from ROS map.yaml file)
 */
export interface MapYamlMetadata {
  image: string;
  resolution: number;
  origin: [number, number, number]; // [x, y, yaw]
  negate?: number;
  occupied_thresh?: number;
  free_thresh?: number;
  mode?: 'trinary' | 'scale' | 'raw';
}

/**
 * Processed Map Data for Rendering
 */
export interface ProcessedMapData {
  imageData: {
    data: Uint8ClampedArray;
    width: number;
    height: number;
  };
  meta: {
    width: number;
    height: number;
    resolution: number;
    origin: [number, number, number];
    occupiedThresh: number;
    freeThresh: number;
  };
  features?: {
    locationTags: Array<{
      id: string;
      name: string;
      x: number;
      y: number;
      theta: number;
    }>;
    missions: Array<{
      id: string;
      name: string;
      steps: string[];
    }>;
  };
}

/**
 * Map Layer Types for Multi-Map System
 */
export interface MapLayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  z_index: number;
  mapId: string;
  type: 'robot' | 'annotation' | 'custom';
}

/**
 * Robot Layer for Rendering Robot Positions
 */
export interface RobotLayer extends MapLayer {
  type: 'robot';
  robotId: string;
  showTrajectory?: boolean;
  showLabel?: boolean;
  color?: string;
  labelOffset?: { x: number; y: number };
  trajectoryLength?: number;
}

/**
 * Annotation Layer for Waypoints and Markers
 */
export interface AnnotationLayer extends MapLayer {
  type: 'annotation';
  annotations: MapAnnotation[];
  editable?: boolean;
  permissions: {
    canAdd: boolean;
    canEdit: boolean;
    canDelete: boolean;
  };
}

/**
 * Map Annotation for Points of Interest
 */
export interface MapAnnotation {
  id: string;
  type: 'waypoint' | 'zone' | 'path' | 'marker';
  position: WorldPoint;
  properties: Record<string, any>;
  createdAt: Date;
  createdBy: string;
  updatedAt?: Date;
  updatedBy?: string;
}

/**
 * Coordinate Transformation Types
 */
export interface MapTransforms {
  resolution: number;
  origin: [number, number, number]; // [x, y, yaw]
  width: number;
  height: number;
}

export interface WorldPoint {
  x: number;
  y: number;
}

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface PixelPoint {
  x: number;
  y: number;
}

/**
 * Robot Registry and TF Tree Types
 */
export interface RobotInfo {
  id: string;
  name?: string;
  mapId?: string;
  currentPose?: ROSPoseStamped;
  lastUpdate?: Date;
  status: 'online' | 'offline' | 'error';
  batteryLevel?: number;
  cpuUsage?: number;
  memoryUsage?: number;
  temperature?: number;
}

export interface RobotFrame {
  robotId: string;
  frameId: string;
  parent: string;
  transform: {
    translation: {
      x: number;
      y: number;
      z: number;
    };
    rotation: {
      x: number;
      y: number;
      z: number;
      w: number;
    };
  };
}

export interface TFRegistry {
  robots: Map<string, RobotInfo>;
  frames: Map<string, RobotFrame>;
  lastUpdate: Date;
}

/**
 * Map Registry Types
 */
export interface MapInfo {
  id: string;
  name: string;
  yamlPath: string;
  pgmPath: string;
  metadata: MapYamlMetadata;
  robots: string[]; // robot IDs assigned to this map
}

export interface MapRegistry {
  maps: Map<string, MapInfo>;
  activeMap: string | null;
  defaultMap: string | null;
}

/**
 * View and Rendering Types
 */
export interface MapViewBounds {
  min: WorldPoint;
  max: WorldPoint;
}

export interface MapViewport {
  center: WorldPoint;
  zoom: number;
  rotation: number;
}

/**
 * Viewport state for multi-map system
 */
export interface ViewportState {
  center: WorldPoint;
  zoom: number;
  rotation: number;
  mapId?: string;
  timestamp?: number;
}

export interface MapPlacement {
  topLeft: CanvasPoint;
  scale: { x: number; y: number };
  rotation: number;
}

/**
 * ROS Topic and Message Types
 */
export interface ROSTopicInfo {
  name: string;
  type: string;
  robotId: string;
}

export interface ROSMessage {
  data: any;
  timestamp: Date;
  topic: string;
  robotId: string;
}
