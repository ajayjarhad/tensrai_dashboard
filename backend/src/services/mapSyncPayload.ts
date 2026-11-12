import { gunzipSync } from 'node:zlib';
import yaml from 'js-yaml';

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

const decodeToBuffer = (raw: unknown): Buffer | null => {
  if (raw instanceof Buffer) return raw;
  if (typeof raw !== 'string') return null;
  try {
    if (isBase64(raw)) return Buffer.from(raw, 'base64');
    return Buffer.from(raw, 'binary');
  } catch {
    return null;
  }
};

export const extractMapContent = (files: any, logger: any, robotId: string) => {
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
  let pgmBytes: Buffer | null = null;

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

export const parseMapMetadata = (yamlText: string, logger: any, robotId: string) => {
  try {
    const metadata = yaml.load(yamlText);
    if (metadata && typeof metadata === 'object') return metadata as any;
    logger.error({ robotId }, 'Map YAML is not a mapping');
  } catch (err) {
    logger.error({ robotId, err }, 'Failed to parse map YAML');
  }
  return null;
};

export const normalizeFeatures = (features: any) => {
  const input = features && typeof features === 'object' ? features : {};
  const rawLocationTags = Array.isArray(input.locationTags) ? input.locationTags : [];
  const rawMissions = Array.isArray(input.missions) ? input.missions : [];

  const locationTags = rawLocationTags.map((tag: any, index: number) => {
    const id = tag?.id ?? tag?.tagId ?? index + 1;
    return {
      ...tag,
      id: String(id),
    };
  });

  const missions = rawMissions.map((mission: any, index: number) => {
    const id = mission?.id ?? mission?.missionId ?? mission?.missionID ?? index + 1;
    const name = mission?.name ?? `Mission ${id}`;
    const locationTagId = Array.isArray(mission?.locationTagId)
      ? mission.locationTagId.map((value: any) => String(value))
      : undefined;
    const steps = Array.isArray(mission?.steps)
      ? mission.steps.map((value: any) => String(value))
      : (locationTagId ?? []);

    return {
      ...mission,
      id: String(id),
      name,
      steps,
      ...(locationTagId ? { locationTagId } : {}),
    };
  });

  return {
    ...input,
    locationTags,
    missions,
  };
};

export const gunzipMapImage = (gzipBytes: Buffer, maxOutputLength: number) => {
  try {
    return gunzipSync(gzipBytes, { maxOutputLength });
  } catch (err) {
    throw new MapSyncFailure(UNREADABLE_MAP_FILES, { cause: err });
  }
};

export const getMapDetails = (files: any) => {
  const features = normalizeFeatures(files.metadata_json ?? {});
  const filename = looksLikeFilename(files.map_yaml, '.yaml') ? files.map_yaml : 'map.yaml';
  const name = filename.replace(/\.yaml$/i, '') || filename;
  return { features, filename, name };
};

export const hasFeaturePayload = (value: any) => value && Object.hasOwn(value, 'metadata_json');

export const getFeaturePayload = (value: any) => value?.metadata_json ?? {};
