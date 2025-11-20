import type { ProcessedMapData } from '@tensrai/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

export function useMapImage(mapData: ProcessedMapData | null) {
  const mapImageRef = useRef<HTMLImageElement | null>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  const cleanup = useCallback(() => {
    if (mapImageRef.current) {
      mapImageRef.current.onload = null;
      mapImageRef.current.onerror = null;
      mapImageRef.current.src = '';
      mapImageRef.current = null;
    }
    if (offscreenCanvasRef.current) {
      offscreenCanvasRef.current.width = 0;
      offscreenCanvasRef.current.height = 0;
      offscreenCanvasRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!mapData) {
      cleanup();
      setImage(null);
      return;
    }

    const createMapImage = (processedData: ProcessedMapData): Promise<HTMLImageElement> => {
      return new Promise((resolve, reject) => {
        try {
          const { imageData } = processedData;

          if (offscreenCanvasRef.current) {
            offscreenCanvasRef.current.width = 0;
            offscreenCanvasRef.current.height = 0;
          }

          const canvas = document.createElement('canvas');
          canvas.width = imageData.width;
          canvas.height = imageData.height;
          offscreenCanvasRef.current = canvas;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Failed to get 2D context for map rendering'));
            return;
          }

          const imgData = new ImageData(
            new Uint8ClampedArray(imageData.data),
            imageData.width,
            imageData.height
          );

          ctx.putImageData(imgData, 0, 0);

          const img = new Image();
          img.onload = () => {
            mapImageRef.current = img;
            resolve(img);
          };
          img.onerror = error => {
            reject(new Error(`Failed to load map image: ${error}`));
          };
          img.src = canvas.toDataURL();
        } catch (error) {
          reject(error);
        }
      });
    };

    createMapImage(mapData)
      .then(img => {
        setImage(img);
      })
      .catch(error => {
        console.error('Failed to create map image:', error);
        setImage(null);
        mapImageRef.current = null;
      });

    return cleanup;
  }, [mapData, cleanup]);

  return image;
}
