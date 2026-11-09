import { worldToMapPixel } from './mapTransforms';
import type { TelemetryOverlayRequest, TelemetryOverlayResponse } from './telemetryOverlay.types';

const DEFAULT_MAX_LASER_POINTS = 450;

const toFloat32Array = (values: number[], usedLength: number) => {
  if (usedLength <= 0) return new Float32Array(0);
  const points = new Float32Array(usedLength);
  points.set(values.slice(0, usedLength));
  return points;
};

const buildPathPoints = (request: TelemetryOverlayRequest) => {
  const { path, transforms } = request;
  if (!path?.poses?.length || !transforms) return new Float32Array(0);

  const values = new Array<number>(path.poses.length * 2);
  let writeIndex = 0;

  for (let index = 0; index < path.poses.length; index += 1) {
    const pose = path.poses[index]?.pose?.position;
    if (!pose) continue;
    const pixel = worldToMapPixel({ x: pose.x, y: pose.y }, transforms);
    if (!Number.isFinite(pixel.x) || !Number.isFinite(pixel.y)) continue;
    values[writeIndex] = pixel.x;
    values[writeIndex + 1] = pixel.y;
    writeIndex += 2;
  }

  return toFloat32Array(values, writeIndex);
};

const laserInputs = (request: TelemetryOverlayRequest) => {
  const { laser, transforms } = request;
  // Use the pose snapshotted at scan arrival; fall back to current pose if unset.
  const pose = request.laserPose ?? request.robotPose;
  if (!laser || !transforms || !pose) return null;
  if (!Array.isArray(laser.ranges) || laser.ranges.length === 0) return null;
  return { laser, transforms, pose };
};

const buildLaserPoints = (request: TelemetryOverlayRequest) => {
  const inputs = laserInputs(request);
  if (!inputs) return new Float32Array(0);
  const { laser, transforms, pose } = inputs;

  const maxLaserPoints = request.maxLaserPoints ?? DEFAULT_MAX_LASER_POINTS;
  const values = new Array<number>(maxLaserPoints * 2);
  let writeIndex = 0;

  const step = Math.max(1, request.laserStep ?? 1);
  const offset = laser.laserOffset ?? { x: 0, y: 0, yaw: 0 };
  const cosOff = Math.cos(offset.yaw);
  const sinOff = Math.sin(offset.yaw);
  const cosPose = Math.cos(pose.theta);
  const sinPose = Math.sin(pose.theta);

  for (let index = 0; index < laser.ranges.length; index += step) {
    const range = laser.ranges[index];
    if (!Number.isFinite(range) || range < laser.range_min || range > laser.range_max) continue;

    const angle = laser.angle_min + index * laser.angle_increment;
    const sx = range * Math.cos(angle);
    const sy = range * Math.sin(angle);
    const bx = offset.x + cosOff * sx - sinOff * sy;
    const by = offset.y + sinOff * sx + cosOff * sy;
    const worldX = pose.x + cosPose * bx - sinPose * by;
    const worldY = pose.y + sinPose * bx + cosPose * by;
    const pixel = worldToMapPixel({ x: worldX, y: worldY }, transforms);
    if (!Number.isFinite(pixel.x) || !Number.isFinite(pixel.y)) continue;
    if (writeIndex >= maxLaserPoints * 2) break;
    values[writeIndex] = pixel.x;
    values[writeIndex + 1] = pixel.y;
    writeIndex += 2;
  }

  return toFloat32Array(values, writeIndex);
};

const ctx: Worker = self as unknown as Worker;

ctx.onmessage = (event: MessageEvent<TelemetryOverlayRequest>) => {
  const request = event.data;
  const response: TelemetryOverlayResponse = {
    requestId: request.requestId,
    laserPoints: buildLaserPoints(request),
    pathPoints: buildPathPoints(request),
  };
  const transferables: Transferable[] = [];
  if (response.laserPoints.byteLength > 0) transferables.push(response.laserPoints.buffer);
  if (response.pathPoints.byteLength > 0) transferables.push(response.pathPoints.buffer);
  ctx.postMessage(response, transferables);
};
