import type { NonSharedBuffer } from 'node:buffer';
import { gunzipSync } from 'node:zlib';
import type { Prisma } from '@prisma/client';
import { isRecord } from '@tensrai/shared';
import type { FastifyBaseLogger } from 'fastify';
import yaml from 'js-yaml';
import type { MapMetadata } from './mapAssets.js';

export type MapSyncLogger = Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;

// One map as the robot sends it. Every field is the robot's, so each is checked where it is read.
export type MapFiles = {
  name?: unknown;
  map_yaml?: unknown;
  map_pgm?: unknown;
  map_yaml_content?: unknown;
  map_pgm_content?: unknown;
  metadata_json?: unknown;
  additional_maps?: unknown;
};

export const asMapFiles = (value: unknown): MapFiles | undefined =>
  isRecord(value) ? value : undefined;

// The robot's JSON, read field by field with optional chaining like the untyped reads before it.
type RawRecord = Record<string, unknown> | null | undefined;

export const UNREADABLE_MAP_FILES = 'Robot map files could not be read';

// A failure whose message is written for the user. Any other exception stays in the logs: the sync
// status reaches every member of the organization, the robot can be a server that organization
// runs, and Prisma's text carries source paths and the database's address.
export class MapSyncFailure extends Error {}

export const looksLikeFilename = (value: unknown, ext: string) =>
  typeof value === 'string' && value.trim().toLowerCase().endsWith(ext) && !value.includes('\n');

// Filenames come from the robot and are shown across the dashboard.
export const UNSAFE_MAP_FILENAME = /[/\\<>\p{Cc}]|\.\./u;

const isBase64 = (value: string) => {
  if (!value || typeof value !== 'string') return false;
  const normalized = value.replace(/\s+/g, '');
  return normalized.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(normalized);
};

const decodeToBuffer = (raw: unknown): NonSharedBuffer | null => {
  // A Buffer here is gunzip's output or a socket frame, never shared memory.
  if (raw instanceof Buffer) return raw as NonSharedBuffer;
  if (typeof raw !== 'string') return null;
  try {
    if (isBase64(raw)) return Buffer.from(raw, 'base64');
    return Buffer.from(raw, 'binary');
  } catch {
    return null;
  }
};

export const extractMapContent = (files: MapFiles, logger: MapSyncLogger, robotId: string) => {
  const mapYamlRaw = files.map_yaml_content ?? files.map_yaml;
  const mapPgmRaw = files.map_pgm_content ?? files.map_pgm;

  logger.info(
    {
      robotId,
      mapYamlType: typeof mapYamlRaw,
      mapPgmType: typeof mapPgmRaw,
      mapYamlSample: typeof mapYamlRaw === 'string' ? mapYamlRaw.slice(0, 64) : undefined,
      mapPgmLength:
        typeof mapPgmRaw === 'string'
          ? mapPgmRaw.length
          : mapPgmRaw instanceof Buffer
            ? mapPgmRaw.length
            : undefined,
    },
    'Mapping payload field types'
  );

  let yamlText: string | undefined;
  let pgmBytes: NonSharedBuffer | null = null;

  const hasYamlContent =
    typeof mapYamlRaw === 'string' &&
    (!looksLikeFilename(mapYamlRaw, '.yaml') || mapYamlRaw.includes('\n'));
  const hasPgmContent =
    mapPgmRaw instanceof Buffer ||
    (typeof mapPgmRaw === 'string' &&
      (!looksLikeFilename(mapPgmRaw, '.pgm') || isBase64(mapPgmRaw)));

  if (hasYamlContent) {
    yamlText = mapYamlRaw as string;
    logger.info(
      { robotId, source: 'inline', yamlLength: yamlText.length },
      'Using inline map YAML'
    );
  }
  if (hasPgmContent) {
    pgmBytes = decodeToBuffer(mapPgmRaw);
    logger.info({ robotId, source: 'inline', pgmBytes: pgmBytes?.length }, 'Using inline map PGM');
  }

  return { yamlText, pgmBytes, hasYamlContent, hasPgmContent };
};

export const parseMapMetadata = (
  yamlText: string,
  logger: MapSyncLogger,
  robotId: string
): MapMetadata | null => {
  try {
    const metadata = yaml.load(yamlText);
    // Any object passes, as before; its fields are read by name and checked where used.
    if (metadata && typeof metadata === 'object') return metadata as MapMetadata;
    logger.error({ robotId }, 'Map YAML is not a mapping');
  } catch (err) {
    logger.error({ robotId, err }, 'Failed to parse map YAML');
  }
  return null;
};

export const normalizeFeatures = (features: unknown): Prisma.InputJsonObject => {
  const input = (features && typeof features === 'object' ? features : {}) as Record<
    string,
    unknown
  >;
  const rawLocationTags: RawRecord[] = Array.isArray(input['locationTags'])
    ? input['locationTags']
    : [];
  const rawMissions: RawRecord[] = Array.isArray(input['missions']) ? input['missions'] : [];

  const locationTags = rawLocationTags.map((tag, index) => {
    const id = tag?.['id'] ?? tag?.['tagId'] ?? index + 1;
    return {
      ...tag,
      id: String(id),
    };
  });

  const missions = rawMissions.map((mission, index) => {
    const id = mission?.['id'] ?? mission?.['missionId'] ?? mission?.['missionID'] ?? index + 1;
    const name = mission?.['name'] ?? `Mission ${id}`;
    const rawLocationTagId = mission?.['locationTagId'];
    const locationTagId = Array.isArray(rawLocationTagId)
      ? rawLocationTagId.map((value: unknown) => String(value))
      : undefined;
    const rawSteps = mission?.['steps'];
    const steps = Array.isArray(rawSteps)
      ? rawSteps.map((value: unknown) => String(value))
      : (locationTagId ?? []);

    return {
      ...mission,
      id: String(id),
      name,
      steps,
      ...(locationTagId ? { locationTagId } : {}),
    };
  });

  // Stored as the map's features; it all came from the robot's JSON message.
  return {
    ...input,
    locationTags,
    missions,
  } as Prisma.InputJsonObject;
};

export const gunzipMapImage = (gzipBytes: Buffer, maxOutputLength: number) => {
  try {
    return gunzipSync(gzipBytes, { maxOutputLength });
  } catch (err) {
    throw new MapSyncFailure(UNREADABLE_MAP_FILES, { cause: err });
  }
};

export const getMapDetails = (files: MapFiles) => {
  const features = normalizeFeatures(files.metadata_json ?? {});
  const filename =
    typeof files.map_yaml === 'string' && looksLikeFilename(files.map_yaml, '.yaml')
      ? files.map_yaml
      : 'map.yaml';
  const name = filename.replace(/\.yaml$/i, '') || filename;
  return { features, filename, name };
};

export const hasFeaturePayload = (value: unknown) =>
  isRecord(value) && Object.hasOwn(value, 'metadata_json');

export const getFeaturePayload = (value: unknown) =>
  (isRecord(value) ? value['metadata_json'] : undefined) ?? {};
