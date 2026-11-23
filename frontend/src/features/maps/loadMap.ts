import { parsePGM } from '@/lib/map/pgm-parser';
import { mapsApi } from './api';
import type { Grid } from './editor/grid';

// A stored map as the editor and Merge maps work on it: its record and its own image bytes.
export const loadMapContent = async (mapId: string) => {
  const detail = await mapsApi.detail(mapId);
  const pgm = parsePGM(await mapsApi.image(mapId, detail.revision ?? detail.contentHash ?? ''));
  const grid: Grid = {
    width: pgm.width,
    height: pgm.height,
    maxVal: pgm.maxVal,
    data: new Uint8Array(pgm.data),
  };
  return { detail, grid };
};
