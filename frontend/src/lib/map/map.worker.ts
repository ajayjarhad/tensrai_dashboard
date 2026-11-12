import type { MapYamlMetadata } from '@tensrai/shared';
import { parsePGM } from './pgm-parser';

export type MapWorkerRequest = {
  requestId: number;
  pgmBuffer: ArrayBuffer;
  yaml: MapYamlMetadata;
};

export type MapWorkerResponse = {
  requestId: number;
  bitmap?: ImageBitmap;
  width?: number;
  height?: number;
  error?: string;
};

const ctx: Worker = self as any;

ctx.onmessage = async (e: MessageEvent<MapWorkerRequest>) => {
  const { requestId, pgmBuffer, yaml } = e.data;

  try {
    const { width, height, maxVal, data } = parsePGM(pgmBuffer);
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

    ctx.postMessage({ requestId, bitmap, width, height } satisfies MapWorkerResponse, [bitmap]);
  } catch (error) {
    ctx.postMessage({
      requestId,
      error: error instanceof Error ? error.message : 'Unknown worker error',
    } satisfies MapWorkerResponse);
  }
};
