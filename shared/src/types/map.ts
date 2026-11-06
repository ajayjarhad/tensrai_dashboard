/**
 * ROS geometry messages and the map data built from them
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

export interface ROSPoseStamped {
  header: ROSHeader;
  pose: ROSPose;
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

export interface PixelPoint {
  x: number;
  y: number;
}
