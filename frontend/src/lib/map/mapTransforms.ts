/**
 * Map Coordinate Transformation Utilities
 * Handles conversions between world, map, pixel, and canvas coordinates
 * Following ROS REP 105 coordinate frame conventions
 */

import type {
  CanvasPoint,
  MapPlacement,
  MapTransforms,
  PixelPoint,
  ROSPose,
  ROSQuaternion,
  WorldPoint,
} from '@tensrai/shared';

/**
 * Convert quaternion to yaw angle (rotation around Z axis)
 */
export function quaternionToYaw(q: ROSQuaternion): number {
  // Extract yaw from quaternion using ROS tf2 convention
  // yaw = atan2(2*(w*z + x*y), 1 - 2*(y^2 + z^2))
  return Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
}

/**
 * Convert yaw angle to quaternion
 */
export function yawToQuaternion(yaw: number): ROSQuaternion {
  const halfYaw = yaw / 2;
  return {
    x: 0,
    y: 0,
    z: Math.sin(halfYaw),
    w: Math.cos(halfYaw),
  };
}

/**
 * Convert world coordinates (meters) to map pixel coordinates
 * Takes into account map origin, resolution, and ROS coordinate conventions
 */
export function worldToMapPixel(worldPoint: WorldPoint, transforms: MapTransforms): PixelPoint {
  const { height, resolution, origin } = transforms;
  const [originX, originY, originYaw] = origin;

  // Translate relative to origin
  const translatedX = worldPoint.x - originX;
  const translatedY = worldPoint.y - originY;

  // Rotate into map frame (inverse of origin rotation)
  const cos = Math.cos(originYaw);
  const sin = Math.sin(originYaw);
  const mapX = translatedX * cos + translatedY * sin;
  const mapY = -translatedX * sin + translatedY * cos;

  // Convert to pixel coordinates
  // Note: ROS uses Y-up, but images use Y-down
  const pixelX = mapX / resolution;
  const pixelY = height - mapY / resolution;

  return { x: pixelX, y: pixelY };
}

/**
 * Convert map pixel coordinates to world coordinates (meters)
 */
export function mapPixelToWorld(pixelPoint: PixelPoint, transforms: MapTransforms): WorldPoint {
  const { height, resolution, origin } = transforms;
  const [originX, originY, originYaw] = origin;

  // Convert pixel to map coordinates (meters)
  const mapX = pixelPoint.x * resolution;
  const mapY = (height - pixelPoint.y) * resolution;

  // Rotate into world frame
  const cos = Math.cos(originYaw);
  const sin = Math.sin(originYaw);
  const worldX = mapX * cos - mapY * sin + originX;
  const worldY = mapX * sin + mapY * cos + originY;

  return { x: worldX, y: worldY };
}

/**
 * Convert map pixel coordinates to canvas coordinates
 * Takes into account canvas placement, scaling, and rotation
 */
export function mapPixelToCanvas(pixelPoint: PixelPoint, placement: MapPlacement): CanvasPoint {
  const { topLeft, scale, rotation } = placement;

  // Apply scale
  let x = pixelPoint.x * scale.x;
  let y = pixelPoint.y * scale.y;

  // Apply rotation around origin
  if (rotation !== 0) {
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const rotatedX = x * cos - y * sin;
    const rotatedY = x * sin + y * cos;
    x = rotatedX;
    y = rotatedY;
  }

  // Apply offset
  return {
    x: x + topLeft.x,
    y: y + topLeft.y,
  };
}

/**
 * Convert canvas coordinates to map pixel coordinates
 */
export function canvasToMapPixel(canvasPoint: CanvasPoint, placement: MapPlacement): PixelPoint {
  const { topLeft, scale, rotation } = placement;

  // Remove offset
  let x = canvasPoint.x - topLeft.x;
  let y = canvasPoint.y - topLeft.y;

  // Remove rotation
  if (rotation !== 0) {
    const cos = Math.cos(-rotation);
    const sin = Math.sin(-rotation);
    const rotatedX = x * cos - y * sin;
    const rotatedY = x * sin + y * cos;
    x = rotatedX;
    y = rotatedY;
  }

  // Remove scale
  return {
    x: x / scale.x,
    y: y / scale.y,
  };
}

/**
 * Convert world coordinates to canvas coordinates (world → pixel → canvas)
 */
export function worldToCanvas(
  worldPoint: WorldPoint,
  transforms: MapTransforms,
  placement: MapPlacement
): CanvasPoint {
  const pixelPoint = worldToMapPixel(worldPoint, transforms);
  return mapPixelToCanvas(pixelPoint, placement);
}

/**
 * Convert canvas coordinates to world coordinates (canvas → pixel → world)
 */
export function canvasToWorld(
  canvasPoint: CanvasPoint,
  placement: MapPlacement,
  transforms: MapTransforms
): WorldPoint {
  const pixelPoint = canvasToMapPixel(canvasPoint, placement);
  return mapPixelToWorld(pixelPoint, transforms);
}

/**
 * Convert ROS pose to world point (extract x, y position)
 */
export function rosPoseToWorld(pose: ROSPose): WorldPoint {
  return {
    x: pose.position.x,
    y: pose.position.y,
  };
}

/**
 * Convert world point and angle to ROS pose
 */
export function worldToRosPose(worldPoint: WorldPoint, yaw: number): ROSPose {
  return {
    position: {
      x: worldPoint.x,
      y: worldPoint.y,
      z: 0,
    },
    orientation: yawToQuaternion(yaw),
  };
}

/**
 * Calculate distance between two world points
 */
export function worldDistance(p1: WorldPoint, p2: WorldPoint): number {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate angle between two world points (in radians)
 */
export function worldAngle(p1: WorldPoint, p2: WorldPoint): number {
  return Math.atan2(p2.y - p1.y, p2.x - p1.x);
}

/**
 * Check if a pixel point is within map bounds
 */
export function isPixelInBounds(pixelPoint: PixelPoint, transforms: MapTransforms): boolean {
  return (
    pixelPoint.x >= 0 &&
    pixelPoint.x < transforms.width &&
    pixelPoint.y >= 0 &&
    pixelPoint.y < transforms.height
  );
}

/**
 * Clamp pixel point to map bounds
 */
export function clampPixelToBounds(pixelPoint: PixelPoint, transforms: MapTransforms): PixelPoint {
  return {
    x: Math.max(0, Math.min(transforms.width - 1, pixelPoint.x)),
    y: Math.max(0, Math.min(transforms.height - 1, pixelPoint.y)),
  };
}

/**
 * Create map transforms object from metadata
 */
export function createMapTransforms(metadata: {
  width: number;
  height: number;
  resolution: number;
  origin: [number, number, number];
}): MapTransforms {
  return {
    width: metadata.width,
    height: metadata.height,
    resolution: metadata.resolution,
    origin: metadata.origin,
  };
}

/**
 * Create map placement object from Konva stage/image state
 */
export function createMapPlacement(params: {
  topLeft: CanvasPoint;
  scale: { x: number; y: number };
  rotation: number;
}): MapPlacement {
  return {
    topLeft: params.topLeft,
    scale: params.scale,
    rotation: params.rotation,
  };
}
