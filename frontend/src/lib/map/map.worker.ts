import type { MapYamlMetadata } from '@tensrai/shared';
import { type ParsedPGM, parsePGM } from './pgm-parser';
import { parsePGMOptimized } from './pgm-parser-optimized';

// Define message types
export type MapWorkerRequest = {
  type: 'PROCESS_MAP';
  requestId: number;
  pgmBuffer: ArrayBuffer;
  yaml: MapYamlMetadata;
  useOptimized?: boolean;
  pgmQuality?: number;
};

export type MapWorkerResponse = {
  type: 'MAP_PROCESSED';
  requestId: number;
  bitmap: ImageBitmap;
  width: number;
  height: number;
  error?: string;
};

const ctx: Worker = self as any;

ctx.onmessage = async (e: MessageEvent<MapWorkerRequest>) => {
  const { type, requestId, pgmBuffer, yaml, useOptimized, pgmQuality } = e.data;

  if (type !== 'PROCESS_MAP') return;

  try {
    let parsedPGM: ParsedPGM;
    if (useOptimized) {
      const result = await parsePGMOptimized(
        pgmBuffer,
        pgmQuality !== undefined ? { quality: pgmQuality } : {}
      );
      parsedPGM = result.parsedPGM;
    } else {
      parsedPGM = parsePGM(pgmBuffer);
    }

    const { width, height, maxVal, data } = parsedPGM;
    const { negate = 0 } = yaml;
    const rgbaBuffer = new Uint8ClampedArray(width * height * 4);

    for (let i = 0; i < width * height; i++) {
      let intensity = data[i];

      if (maxVal !== 255) {
        intensity = Math.round((intensity / maxVal) * 255);
      }

      if (negate === 1) {
        intensity = 255 - intensity;
      }

      const pixelIndex = i * 4;
      rgbaBuffer[pixelIndex] = intensity;
      rgbaBuffer[pixelIndex + 1] = intensity;
      rgbaBuffer[pixelIndex + 2] = intensity;
      rgbaBuffer[pixelIndex + 3] = 255;
    }

    const imageData = new ImageData(rgbaBuffer, width, height);
    const bitmap = await createImageBitmap(imageData);

    ctx.postMessage(
      {
        type: 'MAP_PROCESSED',
        requestId,
        bitmap,
        width,
        height,
      },
      [bitmap]
    );
  } catch (error) {
    ctx.postMessage({
      type: 'MAP_PROCESSED',
      requestId,
      error: error instanceof Error ? error.message : 'Unknown worker error',
    } as any);
  }
};
