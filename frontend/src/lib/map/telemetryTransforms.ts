import type { ROSQuaternion } from '@tensrai/shared';
import type { OdometryMessage, Pose2D } from '../../types/telemetry';
import { quaternionToYaw } from './mapTransforms';

const safeQuaternionToYaw = (orientation: Partial<ROSQuaternion> | null | undefined): number =>
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
