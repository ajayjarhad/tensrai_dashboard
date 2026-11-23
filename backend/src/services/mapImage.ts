import { gunzipSync, gzipSync } from 'node:zlib';

// Map images are stored gzipped: an occupancy grid compresses 50 to 100 times, so a map's record
// stays far below Mongo's 16 MiB document limit. Records stored earlier hold the raw PGM ("P5").
export const isGzipped = (image: Uint8Array) => image[0] === 0x1f && image[1] === 0x8b;

export const storedImage = (pgm: Uint8Array) => gzipSync(pgm);

export const pgmOf = (image: Uint8Array) =>
  isGzipped(image) ? gunzipSync(image) : Buffer.from(image);
