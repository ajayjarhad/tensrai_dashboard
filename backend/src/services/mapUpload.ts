import type { NonSharedBuffer } from 'node:buffer';
import { gunzipSync } from 'node:zlib';
import type { Prisma } from '@prisma/client';
import {
  MAP_FEATURE_LIMITS,
  MAP_YAML_MAX_BYTES,
  MapFeaturesSchema,
  MapYamlSchema,
  mapFeatureProblem,
} from '@tensrai/shared';
import yaml from 'js-yaml';
import { generateMapAssets, parsePgm } from './mapAssets.js';
import { storedImage } from './mapImage.js';
import { mapRevision, sha256 } from './mapRevision.js';
import { canonicalFeatures, nonIntegerIds } from './robotMetadata.js';

// A rejected map, with a message written for the person who sent it.
export class MapInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

// The largest image accepted from a person, about 15 M cells: the editor and the dashboard draw the
// whole floor into one canvas, and larger floors are untested there. Stored gzipped (mapImage.ts), a
// record could hold far larger ones; robots' own maps have no such cap.
export const MAX_PGM_BYTES = 15 * 1024 * 1024;
// One Mongo document holds 16 MiB: the image, its display assets, the features and the rest.
const DOCUMENT_BUDGET_BYTES = 15.5 * 1024 * 1024;

export const decodeUploadedPgm = (pgmGzipBase64: string) => {
  let pgm: NonSharedBuffer;
  try {
    pgm = gunzipSync(Buffer.from(pgmGzipBase64, 'base64'), { maxOutputLength: MAX_PGM_BYTES });
  } catch (error) {
    if (
      error instanceof RangeError ||
      (error as { code?: string })?.code === 'ERR_BUFFER_TOO_LARGE'
    ) {
      throw new MapInputError(
        'MAP_TOO_LARGE',
        'The map image is larger than the editor supports (about 15 million cells).',
        413
      );
    }
    throw new MapInputError('INVALID_IMAGE', 'The map image is not a gzipped PGM.');
  }
  try {
    const { width, height } = parsePgm(pgm);
    return { pgm, width, height };
  } catch (error) {
    throw new MapInputError(
      'INVALID_IMAGE',
      `The map image must be a binary PGM (P5): ${error instanceof Error ? error.message : 'unreadable'}.`
    );
  }
};

export const parseMapYaml = (text: string) => {
  if (Buffer.byteLength(text, 'utf8') > MAP_YAML_MAX_BYTES) {
    throw new MapInputError('INVALID_YAML', 'The map YAML is longer than 16 KiB.');
  }
  let parsed: unknown;
  try {
    parsed = yaml.load(text);
  } catch (error) {
    const line = (error as { mark?: { line?: number } })?.mark?.line;
    throw new MapInputError(
      'INVALID_YAML',
      `The map YAML does not parse${line !== undefined ? ` (line ${line + 1})` : ''}.`
    );
  }
  const result = MapYamlSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    throw new MapInputError('INVALID_YAML', `${where}${issue?.message ?? 'invalid map YAML'}`);
  }
  return result.data;
};

// Rules a robot can't recover from, checked before anything is saved or sent.
const checkTagPlacement = (features: Record<string, unknown>) => {
  const problem = mapFeatureProblem(features);
  if (problem) throw new MapInputError(problem.code, problem.message);
};

export const parseMapFeatures = (features: unknown) => {
  const source = features ?? {};
  if (Buffer.byteLength(JSON.stringify(source), 'utf8') > MAP_FEATURE_LIMITS.bytes) {
    throw new MapInputError('INVALID_FEATURES', 'The map features are larger than 1 MiB.', 413);
  }
  const result = MapFeaturesSchema.safeParse(source);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new MapInputError(
      'INVALID_FEATURES',
      `${issue?.path.join('.') ?? 'features'}: ${issue?.message ?? 'invalid'}`
    );
  }
  const ids = nonIntegerIds(result.data);
  if (ids.tags.length > 0 || ids.missions.length > 0) {
    throw new MapInputError(
      'NON_INTEGER_IDS',
      'Robots need whole-number tag and mission ids. Renumber them to save this map.'
    );
  }
  const canonical = canonicalFeatures(result.data) as Record<string, unknown>;
  checkTagPlacement(canonical);
  return canonical;
};

// Everything a map record stores about its content, built from an image and a YAML object. Display
// assets are dropped when the record would not fit in one document; the dashboard then draws the PGM.
export const buildMapContent = async (
  pgm: NonSharedBuffer,
  metadata: Record<string, unknown>,
  features: Record<string, unknown>
) => {
  const imageSha256 = sha256(pgm);
  const image = storedImage(pgm);
  const assets = await generateMapAssets(pgm, metadata);
  const featureBytes = Buffer.byteLength(JSON.stringify(features), 'utf8');
  if (image.length + featureBytes > DOCUMENT_BUDGET_BYTES) {
    throw new MapInputError('MAP_TOO_LARGE', 'This map is too large to store as one map.', 413);
  }
  const assetBytes =
    (assets.displayWebpSizeBytes ?? 0) +
    (assets.displayPngSizeBytes ?? 0) +
    (assets.previewSizeBytes ?? 0);
  const {
    displayWebp: _webp,
    displayWebpSizeBytes: _webpSize,
    displayWebpGeneratedAt: _webpAt,
    displayPng: _png,
    displayPngSizeBytes: _pngSize,
    displayPngGeneratedAt: _pngAt,
    ...withoutDisplay
  } = assets;
  return {
    image,
    metadata: metadata as Prisma.InputJsonObject,
    features: features as Prisma.InputJsonObject,
    imageSha256,
    revision: mapRevision({ imageSha256, yaml: metadata, features }),
    ...(image.length + featureBytes + assetBytes <= DOCUMENT_BUDGET_BYTES
      ? assets
      : {
          ...withoutDisplay,
          displayWebp: null,
          displayWebpSizeBytes: null,
          displayPng: null,
          displayPngSizeBytes: null,
          displayGenerationError: 'Display image left out: the map is too large for one record',
        }),
  };
};

export const yamlTextOf = (metadata: unknown) =>
  yaml.dump(metadata ?? {}, { flowLevel: 1, lineWidth: -1, noRefs: true });
