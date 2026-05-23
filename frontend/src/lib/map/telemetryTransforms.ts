import type { MapTransforms, PixelPoint, ROSPose } from '@tensrai/shared';
import type { LaserScan, OdometryMessage, PathMessage, Pose2D } from '../../types/telemetry';
import { quaternionToYaw, worldToMapPixel } from './mapTransforms';

const safeQuaternionToYaw = (orientation: any): number =>
  quaternionToYaw({
    x: orientation?.x ?? 0,
    y: orientation?.y ?? 0,
    z: orientation?.z ?? 0,
    w: orientation?.w ?? 1,
  });

export const odomToPose = (odom: OdometryMessage): Pose2D => {
  const { position, orientation } = odom.pose.pose;
  return {
    x: position?.x ?? 0,
    y: position?.y ?? 0,
    theta: safeQuaternionToYaw(orientation),
  };
};

export const rosPoseToPose2D = (pose: ROSPose): Pose2D => ({
  x: pose.position?.x ?? 0,
  y: pose.position?.y ?? 0,
  theta: safeQuaternionToYaw(pose.orientation),
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
  step: number = 1
): PixelPoint[] => {
  const points: PixelPoint[] = [];
  const { angle_min, angle_increment, ranges, range_min, range_max } = scan;
  const offset = scan.laserOffset ?? { x: 0, y: 0, yaw: 0 };
  const cosOff = Math.cos(offset.yaw);
  const sinOff = Math.sin(offset.yaw);
  const cosPose = Math.cos(robotPose.theta);
  const sinPose = Math.sin(robotPose.theta);

  for (let i = 0; i < ranges.length; i += step) {
    const r = ranges[i];
    if (!Number.isFinite(r) || r < range_min || r > range_max) continue;

    const angle = angle_min + i * angle_increment;
    const sx = r * Math.cos(angle);
    const sy = r * Math.sin(angle);
    const bx = offset.x + cosOff * sx - sinOff * sy;
    const by = offset.y + sinOff * sx + cosOff * sy;
    const worldX = robotPose.x + cosPose * bx - sinPose * by;
    const worldY = robotPose.y + sinPose * bx + cosPose * by;

    const pixel = worldToMapPixel({ x: worldX, y: worldY }, transforms);
    if (Number.isFinite(pixel.x) && Number.isFinite(pixel.y)) {
      points.push(pixel);
    }
  }

  return points;
};
