import { worldToMapPixel } from './mapTransforms';
import type { TelemetryOverlayRequest, TelemetryOverlayResponse } from './telemetryOverlay.types';

const EMPTY_POINTS = new Float32Array(0);
const DEFAULT_MAX_LASER_POINTS = 450;
// Keep the worker-based coordinate transform, but disable the raster overlay path for now.
// Rendering a pre-rasterized bitmap inside the transformed Konva scene introduced
// drift/zoom artifacts. A proper OffscreenCanvas overlay needs its own synced canvas layer.
const ENABLE_RASTER_OVERLAY = false;
let overlayCanvas: OffscreenCanvas | null = null;
let overlayContext: OffscreenCanvasRenderingContext2D | null = null;

const toFloat32Array = (values: number[], usedLength: number) => {
  if (usedLength <= 0) return EMPTY_POINTS;
  const points = new Float32Array(usedLength);
  points.set(values.slice(0, usedLength));
  return points;
};

const buildPathPoints = (request: TelemetryOverlayRequest) => {
  const { path, transforms } = request;
  if (!path?.poses?.length || !transforms) return EMPTY_POINTS;

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

const buildLaserPoints = (request: TelemetryOverlayRequest) => {
  const { laser, robotPose, transforms } = request;
  if (!laser || !transforms) return EMPTY_POINTS;

  const maxLaserPoints = request.maxLaserPoints ?? DEFAULT_MAX_LASER_POINTS;
  const values = new Array<number>(maxLaserPoints * 2);
  let writeIndex = 0;

  const pushPixel = (x: number, y: number) => {
    if (writeIndex >= maxLaserPoints * 2) return false;
    values[writeIndex] = x;
    values[writeIndex + 1] = y;
    writeIndex += 2;
    return true;
  };

  if (Array.isArray(laser.points) && laser.points.length > 0) {
    const frame = typeof laser.frame === 'string' ? laser.frame.toLowerCase() : '';
    const step = Math.max(1, Math.ceil(laser.points.length / maxLaserPoints));
    if (frame === 'map') {
      for (let index = 0; index < laser.points.length; index += step) {
        const point = laser.points[index];
        if (!point) continue;
        const pixel = worldToMapPixel({ x: point.x, y: point.y }, transforms);
        if (!Number.isFinite(pixel.x) || !Number.isFinite(pixel.y)) continue;
        if (!pushPixel(pixel.x, pixel.y)) break;
      }
      return toFloat32Array(values, writeIndex);
    }
  }

  if (!robotPose || !Array.isArray(laser.ranges) || laser.ranges.length === 0) {
    return EMPTY_POINTS;
  }

  const step = Math.max(1, request.laserStep ?? 2);

  for (let index = 0; index < laser.ranges.length; index += step) {
    const range = laser.ranges[index];
    if (!Number.isFinite(range) || range < laser.range_min || range > laser.range_max) continue;

    const angle = robotPose.theta + laser.angle_min + index * laser.angle_increment;
    const worldX = robotPose.x + range * Math.cos(angle);
    const worldY = robotPose.y + range * Math.sin(angle);
    const pixel = worldToMapPixel({ x: worldX, y: worldY }, transforms);
    if (!Number.isFinite(pixel.x) || !Number.isFinite(pixel.y)) continue;
    if (!pushPixel(pixel.x, pixel.y)) break;
  }

  return toFloat32Array(values, writeIndex);
};

const ensureOverlayCanvas = (width: number, height: number) => {
  if (typeof OffscreenCanvas === 'undefined') return null;
  if (!overlayCanvas || overlayCanvas.width !== width || overlayCanvas.height !== height) {
    overlayCanvas = new OffscreenCanvas(width, height);
    overlayContext = overlayCanvas.getContext('2d', { alpha: true });
  }
  return overlayCanvas && overlayContext ? { canvas: overlayCanvas, ctx: overlayContext } : null;
};

const buildOverlayBitmap = (
  request: TelemetryOverlayRequest,
  laserPoints: Float32Array,
  pathPoints: Float32Array
) => {
  if (!request.transforms) return undefined;
  const surface = ensureOverlayCanvas(request.transforms.width, request.transforms.height);
  if (!surface) return undefined;

  const { ctx, canvas } = surface;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (pathPoints.length >= 4) {
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([12, 10]);
    ctx.beginPath();
    ctx.moveTo(pathPoints[0] ?? 0, pathPoints[1] ?? 0);
    for (let index = 2; index < pathPoints.length; index += 2) {
      ctx.lineTo(pathPoints[index] ?? 0, pathPoints[index + 1] ?? 0);
    }
    ctx.stroke();
    ctx.restore();
  }

  if (laserPoints.length >= 2) {
    const stageScale = Math.max(request.stageScale ?? 1, 0.001);
    const baseRadius = 2 * 1.7;
    const radius = Math.max(0.75, baseRadius / stageScale);

    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = '#ef4444';
    for (let index = 0; index < laserPoints.length; index += 2) {
      const x = laserPoints[index] ?? 0;
      const y = laserPoints[index + 1] ?? 0;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  return canvas.transferToImageBitmap();
};

const ctx: Worker = self as unknown as Worker;

ctx.onmessage = (event: MessageEvent<TelemetryOverlayRequest>) => {
  const request = event.data;
  const laserPoints = buildLaserPoints(request);
  const pathPoints = buildPathPoints(request);
  const overlayBitmap = ENABLE_RASTER_OVERLAY
    ? buildOverlayBitmap(request, laserPoints, pathPoints)
    : undefined;
  const response: TelemetryOverlayResponse = {
    requestId: request.requestId,
    laserPoints,
    pathPoints,
    ...(overlayBitmap ? { overlayBitmap } : {}),
  };
  const transferables: Transferable[] = [response.laserPoints.buffer, response.pathPoints.buffer];
  if (overlayBitmap) {
    transferables.push(overlayBitmap);
  }
  ctx.postMessage(response, transferables);
};
