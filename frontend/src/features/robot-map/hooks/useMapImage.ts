import type { ProcessedMapData } from '@tensrai/shared';
import { useEffect, useRef, useState } from 'react';

/**
 * Builds a canvas from ProcessedMapData.imageData and returns it for KonvaImage.
 */
export function useMapImage(mapData: ProcessedMapData | null | undefined, mapId: string = 'map') {
  const canvasCache = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const [image, setImage] = useState<HTMLCanvasElement | undefined>(undefined);

  useEffect(() => {
    if (!mapData || !mapData.imageData) {
      setImage(undefined);
      return;
    }

    const cached = canvasCache.current.get(mapId);
    if (cached) {
      setImage(cached);
      return;
    }

    const { imageData } = mapData;
    if (!imageData.width || !imageData.height || !imageData.data) {
      setImage(undefined);
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setImage(undefined);
      return;
    }

    const imgData = new ImageData(
      new Uint8ClampedArray(imageData.data),
      imageData.width,
      imageData.height
    );
    ctx.putImageData(imgData, 0, 0);

    canvasCache.current.set(mapId, canvas);
    setImage(canvas);
  }, [mapData, mapId]);

  useEffect(() => {
    return () => {
      canvasCache.current.forEach(c => {
        c.width = 0;
        c.height = 0;
      });
      canvasCache.current.clear();
    };
  }, []);

  return image;
}
