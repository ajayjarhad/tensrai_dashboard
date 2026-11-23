import {
  type LocationTag,
  type MapFeatures,
  type MapPath,
  type MapYaml,
  type MapZone,
  missionSteps,
  type PathType,
  pointInPolygon,
  type TagType,
  type ZoneType,
} from '@tensrai/shared';
import { nanoid } from 'nanoid';
import { mapPixelToWorld, worldToMapPixel } from '@/lib/map/mapTransforms';
import type { Grid, Point } from './grid';

export type FeatureKind = 'zone' | 'path' | 'tag';

export const ZONE_STYLE: Record<ZoneType, { color: string; label: string }> = {
  no_go: { color: '#b91c1c', label: 'No-go zone' },
  work: { color: '#1d4ed8', label: 'Work zone' },
  named: { color: '#334155', label: 'Named zone' },
  trigger: { color: '#b45309', label: 'Trigger zone' },
  pick: { color: '#0f766e', label: 'Pick zone' },
  drop: { color: '#a21caf', label: 'Drop zone' },
};

export const PATH_STYLE: Record<PathType, { color: string; label: string }> = {
  preferred: { color: '#2085e9', label: 'Preferred path' },
  virtual_wall: { color: '#b91c1c', label: 'Virtual wall' },
};

export const TAG_LABEL: Record<TagType, string> = { mission: 'Mission location', home: 'Home' };

const LIST = { zone: 'zones', path: 'paths', tag: 'locationTags' } as const;
type Item = { id: string | number } & Record<string, unknown>;

// Selections are "kind:id", so zones, paths and tags can share ids without clashing.
export const selectionKey = (kind: FeatureKind, id: string | number) => `${kind}:${id}`;
export const parseSelection = (key: string | null) => {
  if (!key) return null;
  const split = key.indexOf(':');
  return { kind: key.slice(0, split) as FeatureKind, id: key.slice(split + 1) };
};

export const itemsOf = (features: MapFeatures, kind: FeatureKind) =>
  (features[LIST[kind]] ?? []) as Item[];

export const findFeature = (features: MapFeatures, key: string | null) => {
  const selection = parseSelection(key);
  if (!selection) return null;
  const item = itemsOf(features, selection.kind).find(entry => String(entry.id) === selection.id);
  return item ? { ...selection, item } : null;
};

export const updateFeature = (
  features: MapFeatures,
  kind: FeatureKind,
  id: string,
  patch: Record<string, unknown>
): MapFeatures => ({
  ...features,
  [LIST[kind]]: itemsOf(features, kind).map(item =>
    String(item.id) === id ? { ...item, ...patch } : item
  ),
});

export const removeFeature = (features: MapFeatures, kind: FeatureKind, id: string) => ({
  ...features,
  [LIST[kind]]: itemsOf(features, kind).filter(item => String(item.id) !== id),
});

// A tag a mission goes to can't be deleted until the mission drops it.
export const missionsUsingTag = (features: MapFeatures, tagId: string) =>
  (features.missions ?? [])
    .filter(mission => missionSteps(mission).some(step => String(step) === tagId))
    .map(mission => String(mission.name ?? mission.missionId ?? mission.id ?? ''));

const numbered = (label: string, count: number) => `${label} ${count + 1}`;

export const addZone = (features: MapFeatures, type: ZoneType, polygon: [number, number][]) => {
  const zones = features.zones ?? [];
  const zone: MapZone = {
    id: `z-${nanoid(8)}`,
    type,
    name: numbered(ZONE_STYLE[type].label, zones.length),
    polygon,
  };
  return { features: { ...features, zones: [...zones, zone] }, key: selectionKey('zone', zone.id) };
};

export const addPath = (features: MapFeatures, type: PathType, points: [number, number][]) => {
  const paths = features.paths ?? [];
  const path: MapPath = {
    id: `p-${nanoid(8)}`,
    type,
    name: numbered(PATH_STYLE[type].label, paths.length),
    points,
    width: type === 'virtual_wall' ? 0.2 : 1,
  };
  return { features: { ...features, paths: [...paths, path] }, key: selectionKey('path', path.id) };
};

// Robots number their tags, so a new tag takes the next whole number.
export const addTag = (features: MapFeatures, x: number, y: number, theta: number) => {
  const tags = features.locationTags ?? [];
  const id = Math.max(0, ...tags.map(tag => Number(tag.id)).filter(Number.isInteger)) + 1;
  const tag: LocationTag = { id, name: `Tag ${id}`, x, y, theta, type: 'mission' };
  return { features: { ...features, locationTags: [...tags, tag] }, key: selectionKey('tag', id) };
};

export const cellTransforms = (grid: Grid, yaml: MapYaml) => ({
  width: grid.width,
  height: grid.height,
  resolution: yaml.resolution,
  origin: yaml.origin,
});
type Transforms = ReturnType<typeof cellTransforms>;

const millimetres = (value: number) => Math.round(value * 1000) / 1000;

export const toCell = ([x, y]: readonly [number, number], transforms: Transforms): Point =>
  worldToMapPixel({ x, y }, transforms);

export const toWorld = (cell: Point, transforms: Transforms): [number, number] => {
  const world = mapPixelToWorld(cell, transforms);
  return [millimetres(world.x), millimetres(world.y)];
};

export const headingBetween = (from: Point, to: Point, originYaw = 0) =>
  Math.atan2(from.y - to.y, to.x - from.x) + originYaw;

// The selected shape's extent on the canvas, in cells: where its card goes.
export const boundsInCells = (
  found: NonNullable<ReturnType<typeof findFeature>>,
  transforms: Transforms
) => {
  const item = found.item;
  const world: (readonly [number, number])[] =
    found.kind === 'tag'
      ? [[Number(item['x']), Number(item['y'])]]
      : ((found.kind === 'zone' ? item['polygon'] : item['points']) as [number, number][]);
  const cells = world.map(point => toCell(point, transforms));
  const xs = cells.map(cell => cell.x);
  const ys = cells.map(cell => cell.y);
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
};

// The zone under a world point, for the coordinates readout.
export const zoneAt = (features: MapFeatures, point: readonly [number, number]) =>
  (features.zones ?? []).find(zone => pointInPolygon(point, zone.polygon));
