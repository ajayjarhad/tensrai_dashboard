import { quaternionToYaw, worldToMapPixel } from './mapTransforms';
import type { MapTransforms, PixelPoint, ROSPose } from '@tensrai/shared';
import type { LaserScan, OdometryMessage, PathMessage, Pose2D } from '../../types/telemetry';

export const odomToPose = (odom: OdometryMessage): Pose2D => {
  const { position, orientation } = odom.pose.pose;
  return {
    x: position.x,
    y: position.y,
    theta: quaternionToYaw(orientation),
  };
};

export const rosPoseToPose2D = (pose: ROSPose): Pose2D => ({
  x: pose.position.x,
  y: pose.position.y,
  theta: quaternionToYaw(pose.orientation),
});

export const pathToPixelPoints = (path: PathMessage, transforms: MapTransforms): PixelPoint[] => {
  const poses = path.poses ?? [];
  return poses
    .map(p => worldToMapPixel({ x: p.pose.position.x, y: p.pose.position.y }, transforms))
    .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
};

export const laserToPixelPoints = (
  scan: LaserScan,
  robotPose: Pose2D,
  transforms: MapTransforms,
  step: number = 2
): PixelPoint[] => {
  const points: PixelPoint[] = [];
  // Prefer precomputed map-frame points; avoid rotating them with robot pose.
  if (Array.isArray(scan.points) && scan.points.length > 0) {
    if (scan.frame === 'map') {
      // Debug: confirm we are using map-frame precomputed points
      if (typeof console !== 'undefined') {
        console.log('[laserToPixelPoints] using map-frame points:', scan.points.length);
      }
      for (let i = 0; i < scan.points.length; i += step) {
        const p = scan.points[i];
        const pixel = worldToMapPixel({ x: p.x, y: p.y }, transforms);
        if (Number.isFinite(pixel.x) && Number.isFinite(pixel.y)) {
          points.push(pixel);
        }
      }
      return points;
    }
    // Non-map-frame precomputed points: skip to avoid incorrect rotation.
    return points;
  }

  // Fallback: compute from ranges using the current pose.
  const { angle_min, angle_increment, ranges, range_min, range_max } = scan;
  for (let i = 0; i < ranges.length; i += step) {
    const r = ranges[i];
    if (!Number.isFinite(r) || r < range_min || r > range_max) continue;

    const angle = robotPose.theta + angle_min + i * angle_increment;
    const worldX = robotPose.x + r * Math.cos(angle);
    const worldY = robotPose.y + r * Math.sin(angle);

    const pixel = worldToMapPixel({ x: worldX, y: worldY }, transforms);
    if (Number.isFinite(pixel.x) && Number.isFinite(pixel.y)) {
      points.push(pixel);
    } else if (typeof console !== 'undefined') {
      console.warn('[laserToPixelPoints] invalid pixel from raw range', {
        worldX,
        worldY,
        angle,
        range: r,
      });
    }
  }

  return points;
};
