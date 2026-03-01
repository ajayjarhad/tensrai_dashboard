import type { LaserScan, PathMessage, Pose2D } from '../../types/telemetry';
import type { MapTransforms } from './mapTransforms';

export type TelemetryOverlayRequest = {
  requestId: number;
  transforms: MapTransforms | null;
  laser?: LaserScan | null;
  path?: PathMessage | null;
  robotPose?: Pose2D | null;
  stageScale?: number;
  laserStep?: number;
  maxLaserPoints?: number;
};

export type TelemetryOverlayResponse = {
  requestId: number;
  laserPoints: Float32Array;
  pathPoints: Float32Array;
  overlayBitmap?: ImageBitmap;
};
