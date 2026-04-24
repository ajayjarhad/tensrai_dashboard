import { useEffect, useRef, useState } from 'react';
import type { MapTransforms } from '@/lib/map/mapTransforms';
import type { TelemetryOverlayResponse } from '@/lib/map/telemetryOverlay.types';
import TelemetryOverlayWorker from '@/lib/map/telemetryOverlay.worker?worker';
import type { LaserScan, PathMessage, Pose2D } from '@/types/telemetry';

const EMPTY_POINTS = new Float32Array(0);

type OverlayState = {
  laserPoints: Float32Array;
  pathPoints: Float32Array;
  overlayBitmap?: ImageBitmap | undefined;
};

interface UseTelemetryOverlayDataOptions {
  transforms: MapTransforms | null;
  laser?: LaserScan | null | undefined;
  path?: PathMessage | null | undefined;
  robotPose?: Pose2D | null | undefined;
  laserPose?: Pose2D | null | undefined;
  stageScale?: number | undefined;
}

export function useTelemetryOverlayData({
  transforms,
  laser,
  path,
  robotPose,
  laserPose,
  stageScale,
}: UseTelemetryOverlayDataOptions): OverlayState {
  const workerRef = useRef<Worker | null>(null);
  const latestRequestIdRef = useRef(0);
  const [state, setState] = useState<OverlayState>({
    laserPoints: EMPTY_POINTS,
    pathPoints: EMPTY_POINTS,
  });
  const bitmapRef = useRef<ImageBitmap | null>(null);

  useEffect(() => {
    const worker = new TelemetryOverlayWorker();
    workerRef.current = worker;

    const handleMessage = (event: MessageEvent<TelemetryOverlayResponse>) => {
      if (event.data.requestId !== latestRequestIdRef.current) return;
      if (bitmapRef.current) {
        bitmapRef.current.close();
        bitmapRef.current = null;
      }
      if (event.data.overlayBitmap) {
        bitmapRef.current = event.data.overlayBitmap;
      }
      setState({
        laserPoints: event.data.laserPoints,
        pathPoints: event.data.pathPoints,
        overlayBitmap: event.data.overlayBitmap ?? undefined,
      });
    };

    worker.addEventListener('message', handleMessage);

    return () => {
      if (bitmapRef.current) {
        bitmapRef.current.close();
        bitmapRef.current = null;
      }
      worker.removeEventListener('message', handleMessage);
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const worker = workerRef.current;
    if (!worker || !transforms) {
      if (bitmapRef.current) {
        bitmapRef.current.close();
        bitmapRef.current = null;
      }
      setState({
        laserPoints: EMPTY_POINTS,
        pathPoints: EMPTY_POINTS,
        overlayBitmap: undefined,
      });
      return;
    }

    latestRequestIdRef.current += 1;
    worker.postMessage({
      requestId: latestRequestIdRef.current,
      transforms,
      laser: laser ?? null,
      path: path ?? null,
      robotPose: robotPose ?? null,
      laserPose: laserPose ?? null,
      stageScale,
      laserStep: 2,
      maxLaserPoints: 450,
    });
  }, [laser, path, robotPose, laserPose, stageScale, transforms]);

  return state;
}
