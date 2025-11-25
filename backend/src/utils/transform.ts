export type Pose2D = { x: number; y: number; yaw: number };

export const quaternionToYaw = (q: { x: number; y: number; z: number; w: number }) =>
  Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));

export const invertTransform = (t: Pose2D): Pose2D => {
  const cos = Math.cos(-t.yaw);
  const sin = Math.sin(-t.yaw);
  const x = -(t.x * cos - t.y * sin);
  const y = -(t.x * sin + t.y * cos);
  return { x, y, yaw: -t.yaw };
};

export const combineTransforms = (a: Pose2D, b: Pose2D): Pose2D => {
  const cos = Math.cos(a.yaw);
  const sin = Math.sin(a.yaw);
  return {
    x: a.x + cos * b.x - sin * b.y,
    y: a.y + sin * b.x + cos * b.y,
    yaw: a.yaw + b.yaw,
  };
};
