import type { ProcessedMapData } from '@tensrai/shared';
import { useEffect, useRef, useState } from 'react';

interface ProcessedMapDataWithBitmap extends ProcessedMapData {
  imageBitmap?: ImageBitmap;
  imageElement?: HTMLImageElement;
  contentHash?: string;
}

export function useMapImage(
  mapData: ProcessedMapDataWithBitmap | null | undefined,
  mapId: string = 'map'
) {
  const imageCache = useRef<Map<string, ImageBitmap | HTMLCanvasElement | HTMLImageElement>>(
    new Map()
  );
  // Track which bitmaps we created locally so we only close those
  const ownedBitmaps = useRef<Set<ImageBitmap>>(new Set());
  const [image, setImage] = useState<
    ImageBitmap | HTMLCanvasElement | HTMLImageElement | undefined
  >(undefined);

  useEffect(() => {
    if (!mapData) {
      setImage(undefined);
      return;
    }

    const dataWithBitmap = mapData as ProcessedMapDataWithBitmap;
    if (dataWithBitmap.imageBitmap) {
      setImage(dataWithBitmap.imageBitmap);
      return;
    }

    if (dataWithBitmap.imageElement) {
      setImage(dataWithBitmap.imageElement);
      return;
    }

    const cached = imageCache.current.get(mapId);
    if (cached) {
      setImage(cached);
      return;
    }

    const { imageData } = mapData;
    if (
      !imageData ||
      !imageData.width ||
      !imageData.height ||
      !imageData.data ||
      imageData.data.length === 0
    ) {
      if (!dataWithBitmap.imageBitmap) {
        setImage(undefined);
      }
      return;
    }

    const createBitmap = async () => {
      try {
        const clampedData = new Uint8ClampedArray(
          imageData.data.buffer,
          imageData.data.byteOffset,
          imageData.data.byteLength
        );
        const imgData = new ImageData(clampedData as any, imageData.width, imageData.height);

        const bitmap = await createImageBitmap(imgData);
        ownedBitmaps.current.add(bitmap);
        imageCache.current.set(mapId, bitmap);
        setImage(bitmap);
      } catch (_error) {
        const canvas = document.createElement('canvas');
        canvas.width = imageData.width;
        canvas.height = imageData.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const clampedData = new Uint8ClampedArray(
            imageData.data.buffer,
            imageData.data.byteOffset,
            imageData.data.byteLength
          );
          const imgData = new ImageData(clampedData as any, imageData.width, imageData.height);
          ctx.putImageData(imgData, 0, 0);
          imageCache.current.set(mapId, canvas);
          setImage(canvas);
        }
      }
    };

    createBitmap();
  }, [mapData, mapId]);

  useEffect(() => {
    return () => {
      imageCache.current.forEach(img => {
        if (img instanceof ImageBitmap) {
          if (ownedBitmaps.current.has(img)) {
            img.close();
          }
        } else {
          img.width = 0;
          img.height = 0;
        }
      });
      imageCache.current.clear();
      ownedBitmaps.current.clear();
    };
  }, []);

  return image;
}
