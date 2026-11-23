import type { MapYaml } from '../schemas/maps.js';

// The map_server keys a map's YAML may hold, checked without zod so the editor stays light.
// MapYamlSchema (schemas/maps.ts) states the same rule for the server; a test keeps them in step.

export type MapYamlCheck =
  | { ok: true; yaml: MapYaml }
  | { ok: false; key: string; message: string };

const KEYS = new Set([
  'image',
  'mode',
  'resolution',
  'origin',
  'negate',
  'occupied_thresh',
  'free_thresh',
]);

const fail = (key: string, message: string): MapYamlCheck => ({ ok: false, key, message });
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const isFraction = (value: unknown) =>
  value === undefined || (isNumber(value) && value >= 0 && value <= 1);

const checkOrigin = (origin: unknown) => {
  if (!Array.isArray(origin) || origin.length !== 3 || !origin.every(isNumber)) {
    return fail('origin', 'origin must be [x, y, yaw] in numbers');
  }
  return origin[2] === 0
    ? null
    : fail(
        'origin',
        'origin yaw must be 0: Nav2 ignores it, so zones would land in the wrong place'
      );
};

const checkOptional = (yaml: Record<string, unknown>) => {
  const image = yaml['image'];
  if (image !== undefined && (typeof image !== 'string' || image.length > 255)) {
    return fail('image', 'image must be a file name');
  }
  if (yaml['mode'] !== undefined && !['trinary', 'scale', 'raw'].includes(String(yaml['mode']))) {
    return fail('mode', 'mode must be trinary, scale or raw');
  }
  const negate = yaml['negate'];
  if (negate !== undefined && negate !== 0 && negate !== 1 && typeof negate !== 'boolean') {
    return fail('negate', 'negate must be 0 or 1');
  }
  for (const key of ['occupied_thresh', 'free_thresh']) {
    if (!isFraction(yaml[key])) return fail(key, `${key} must be between 0 and 1`);
  }
  return null;
};

export const checkMapYaml = (value: unknown): MapYamlCheck => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('', 'a map YAML is a list of settings');
  }
  const yaml = value as Record<string, unknown>;
  const unknown = Object.keys(yaml).find(key => !KEYS.has(key));
  if (unknown) return fail(unknown, `${unknown} is not a map setting`);
  const resolution = yaml['resolution'];
  if (!isNumber(resolution) || resolution <= 0 || resolution > 10) {
    return fail('resolution', 'resolution must be a number of metres, above 0');
  }
  return checkOrigin(yaml['origin']) ?? checkOptional(yaml) ?? { ok: true, yaml: yaml as MapYaml };
};
