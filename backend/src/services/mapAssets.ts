import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';

type MapMetadata = Record<string, unknown>;

export type ParsedPgmImage = {
  width: number;
  height: number;
  maxVal: number;
  data: Uint8Array;
};

export type GeneratedMapAssets = {
  contentHash: string;
  pixelWidth?: number;
  pixelHeight?: number;
  imageSizeBytes: number;
  displayWebp?: Buffer;
  displayWebpSizeBytes?: number;
  displayWebpGeneratedAt?: Date;
  displayPng?: Buffer;
  displayPngSizeBytes?: number;
  displayPngGeneratedAt?: Date;
  previewWebp?: Buffer;
  previewPng?: Buffer;
  previewSizeBytes?: number;
  displayGenerationError?: string;
};

const PREVIEW_MAX_DIMENSION = 512;

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(',')}}`;
};

export const computeMapContentHash = (pgmBytes: Buffer, metadata: MapMetadata) =>
  createHash('sha256')
    .update(pgmBytes)
    .update('\n')
    .update(stableStringify(metadata))
    .digest('hex');

const readAsciiToken = (bytes: Uint8Array, offset: number) => {
  let cursor = offset;

  while (cursor < bytes.length) {
    const value = bytes[cursor];
    if (value === 35) {
      while (cursor < bytes.length && bytes[cursor] !== 10) cursor += 1;
      continue;
    }
    if (value === 9 || value === 10 || value === 13 || value === 32) {
      cursor += 1;
      continue;
    }
    break;
  }

  const start = cursor;
  while (cursor < bytes.length) {
    const value = bytes[cursor];
    if (value === 9 || value === 10 || value === 13 || value === 32 || value === 35) break;
    cursor += 1;
  }

  if (start === cursor) {
    throw new Error('Malformed PGM header');
  }

  return {
    token: Buffer.from(bytes.subarray(start, cursor)).toString('ascii'),
    offset: cursor,
  };
};

const consumeSingleWhitespace = (bytes: Uint8Array, offset: number) => {
  if (offset >= bytes.length) return offset;
  const value = bytes[offset];
  if (value === 9 || value === 10 || value === 13 || value === 32) {
    return offset + 1;
  }
  return offset;
};

export const parsePgm = (pgmBytes: Buffer): ParsedPgmImage => {
  const bytes = new Uint8Array(pgmBytes.buffer, pgmBytes.byteOffset, pgmBytes.byteLength);
  let offset = 0;
  const magic = readAsciiToken(bytes, offset);
  offset = magic.offset;
  if (magic.token !== 'P5') {
    throw new Error(`Unsupported PGM format: ${magic.token}`);
  }

  const widthToken = readAsciiToken(bytes, offset);
  offset = widthToken.offset;
  const heightToken = readAsciiToken(bytes, offset);
  offset = heightToken.offset;
  const maxValToken = readAsciiToken(bytes, offset);
  offset = maxValToken.offset;
  offset = consumeSingleWhitespace(bytes, offset);

  const width = Number.parseInt(widthToken.token, 10);
  const height = Number.parseInt(heightToken.token, 10);
  const maxVal = Number.parseInt(maxValToken.token, 10);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error('Invalid PGM dimensions');
  }
  if (!Number.isFinite(maxVal) || maxVal <= 0 || maxVal > 255) {
    throw new Error(`Unsupported PGM max value: ${maxVal}`);
  }

  const expectedLength = width * height;
  if (bytes.length - offset < expectedLength) {
    throw new Error('PGM pixel data is shorter than declared dimensions');
  }

  return {
    width,
    height,
    maxVal,
    data: bytes.slice(offset, offset + expectedLength),
  };
};

const pgmToRgba = (pgm: ParsedPgmImage, metadata: MapMetadata) => {
  const negate = Number(metadata['negate'] ?? 0);
  const rgba = new Uint8ClampedArray(pgm.width * pgm.height * 4);

  for (let index = 0; index < pgm.width * pgm.height; index += 1) {
    let intensity = pgm.data[index] ?? 0;
    if (pgm.maxVal !== 255) {
      intensity = Math.round((intensity / pgm.maxVal) * 255);
    }
    if (negate === 1) {
      intensity = 255 - intensity;
    }

    const pixelOffset = index * 4;
    rgba[pixelOffset] = intensity;
    rgba[pixelOffset + 1] = intensity;
    rgba[pixelOffset + 2] = intensity;
    rgba[pixelOffset + 3] = 255;
  }

  return rgba;
};

const downsampleRgba = (rgba: Uint8ClampedArray, width: number, height: number) => {
  const scale = Math.min(1, PREVIEW_MAX_DIMENSION / Math.max(width, height));
  if (scale >= 1) {
    return { data: rgba, width, height };
  }

  const previewWidth = Math.max(1, Math.round(width * scale));
  const previewHeight = Math.max(1, Math.round(height * scale));
  const preview = new Uint8ClampedArray(previewWidth * previewHeight * 4);

  for (let y = 0; y < previewHeight; y += 1) {
    const sourceY = Math.min(height - 1, Math.floor(y / scale));
    for (let x = 0; x < previewWidth; x += 1) {
      const sourceX = Math.min(width - 1, Math.floor(x / scale));
      const sourceOffset = (sourceY * width + sourceX) * 4;
      const targetOffset = (y * previewWidth + x) * 4;
      preview[targetOffset] = rgba[sourceOffset] ?? 0;
      preview[targetOffset + 1] = rgba[sourceOffset + 1] ?? 0;
      preview[targetOffset + 2] = rgba[sourceOffset + 2] ?? 0;
      preview[targetOffset + 3] = rgba[sourceOffset + 3] ?? 255;
    }
  }

  return { data: preview, width: previewWidth, height: previewHeight };
};

const encodePng = (rgba: Uint8ClampedArray, width: number, height: number) => {
  const png = new PNG({ width, height });
  png.data = Buffer.from(rgba);
  return PNG.sync.write(png);
};

const encodeWebp = async (rgba: Uint8ClampedArray, width: number, height: number) => {
  const webp = await import('@jsquash/webp');
  const encoded = await webp.encode(
    {
      data: rgba,
      width,
      height,
    } as any,
    { lossless: 1, quality: 100, exact: 1, near_lossless: 100 }
  );
  return Buffer.from(encoded);
};

export const generateMapAssets = async (
  pgmBytes: Buffer,
  metadata: MapMetadata
): Promise<GeneratedMapAssets> => {
  const contentHash = computeMapContentHash(pgmBytes, metadata);
  const base: GeneratedMapAssets = {
    contentHash,
    imageSizeBytes: pgmBytes.length,
  };

  let pgm: ParsedPgmImage;
  try {
    pgm = parsePgm(pgmBytes);
  } catch (error) {
    return {
      ...base,
      displayGenerationError:
        error instanceof Error ? error.message : 'Failed to parse PGM for display assets',
    };
  }

  const rgba = pgmToRgba(pgm, metadata);
  const preview = downsampleRgba(rgba, pgm.width, pgm.height);
  const generatedAt = new Date();
  const errors: string[] = [];
  const assets: GeneratedMapAssets = {
    ...base,
    pixelWidth: pgm.width,
    pixelHeight: pgm.height,
  };

  try {
    const displayWebp = await encodeWebp(rgba, pgm.width, pgm.height);
    assets.displayWebp = displayWebp;
    assets.displayWebpSizeBytes = displayWebp.length;
    assets.displayWebpGeneratedAt = generatedAt;
    const previewWebp = await encodeWebp(preview.data, preview.width, preview.height);
    assets.previewWebp = previewWebp;
    assets.previewSizeBytes = previewWebp.length;
  } catch (error) {
    errors.push(`webp: ${error instanceof Error ? error.message : String(error)}`);

    try {
      const displayPng = encodePng(rgba, pgm.width, pgm.height);
      assets.displayPng = displayPng;
      assets.displayPngSizeBytes = displayPng.length;
      assets.displayPngGeneratedAt = generatedAt;

      const previewPng = encodePng(preview.data, preview.width, preview.height);
      assets.previewPng = previewPng;
      assets.previewSizeBytes = previewPng.length;
    } catch (pngError) {
      errors.push(`png: ${pngError instanceof Error ? pngError.message : String(pngError)}`);
    }
  }

  if (errors.length > 0) {
    assets.displayGenerationError = errors.join('; ');
  }

  return assets;
};
