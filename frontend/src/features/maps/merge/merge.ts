import type { LocationTag, MapFeatures, MapPath, MapYaml, MapZone } from '@tensrai/shared';
import { mapPixelToWorld, worldToMapPixel } from '@/lib/map/mapTransforms';
import type { Grid } from '../editor/grid';
import { type Placement, type StagePoint, toLayer, toStage } from './align';

export interface MergeLayer {
  grid: Grid;
  yaml: MapYaml;
  placement: Placement;
}

// The merged map is trinary, whatever its layers were: map_saver's values.
export const MERGED = { occupied: 0, free: 254, unknown: 205 } as const;

// map_server's reading of a pixel, with the layer's own thresholds.
export const occupancyOf = (value: number, grid: Grid, yaml: MapYaml) => {
  const shade = value / (grid.maxVal || 255);
  const occupancy = yaml.negate ? shade : 1 - shade;
  if (occupancy > (yaml.occupied_thresh ?? 0.65)) return MERGED.occupied;
  if (occupancy < (yaml.free_thresh ?? 0.196)) return MERGED.free;
  return MERGED.unknown;
};

const corners = ({ grid, placement }: MergeLayer) =>
  [
    [0, 0],
    [grid.width, 0],
    [0, grid.height],
    [grid.width, grid.height],
  ].map(([u, v]) => toStage(placement, u ?? 0, v ?? 0));

export const mergedBounds = (layers: MergeLayer[]) => {
  const points = layers.flatMap(corners);
  const left = Math.floor(Math.min(...points.map(point => point.x)));
  const top = Math.floor(Math.min(...points.map(point => point.y)));
  return {
    left,
    top,
    width: Math.ceil(Math.max(...points.map(point => point.x))) - left,
    height: Math.ceil(Math.max(...points.map(point => point.y))) - top,
  };
};

const sampleTopDown = (topDown: MergeLayer[], point: StagePoint) => {
  for (const layer of topDown) {
    const at = toLayer(layer.placement, point);
    const u = Math.floor(at.x);
    const v = Math.floor(at.y);
    if (u < 0 || v < 0 || u >= layer.grid.width || v >= layer.grid.height) continue;
    const value = occupancyOf(
      layer.grid.data[v * layer.grid.width + u] ?? 0,
      layer.grid,
      layer.yaml
    );
    if (value !== MERGED.unknown) return value;
  }
  return MERGED.unknown;
};

// Every cell of the result takes the first layer, from the top down, that knows what is there.
// Nearest-neighbour sampling: no layer is blurred.
export const mergeGrids = (layers: MergeLayer[], resolution: number) => {
  const bounds = mergedBounds(layers);
  const data = new Uint8Array(bounds.width * bounds.height);
  const topDown = [...layers].reverse();
  for (let row = 0; row < bounds.height; row += 1) {
    for (let col = 0; col < bounds.width; col += 1) {
      const point = { x: bounds.left + col + 0.5, y: bounds.top + row + 0.5 };
      data[row * bounds.width + col] = sampleTopDown(topDown, point);
    }
  }
  const grid: Grid = { width: bounds.width, height: bounds.height, maxVal: 255, data };
  // The reference's world: stage y runs down, world y up, both in reference pixels.
  const yaml: MapYaml = {
    resolution,
    origin: [bounds.left * resolution, -(bounds.top + bounds.height) * resolution, 0],
    negate: 0,
    occupied_thresh: 0.65,
    free_thresh: 0.196,
    mode: 'trinary',
  };
  return { grid, yaml };
};

// A point in a layer's own world, carried into the reference world through its placement.
export const layerToReference = (layer: MergeLayer, resolution: number) => {
  const transforms = {
    width: layer.grid.width,
    height: layer.grid.height,
    resolution: layer.yaml.resolution,
    origin: layer.yaml.origin,
  };
  const turn = (-layer.placement.rotation * Math.PI) / 180 - layer.yaml.origin[2];
  return {
    point: (x: number, y: number): [number, number] => {
      const pixel = worldToMapPixel({ x, y }, transforms);
      const stage: StagePoint = toStage(layer.placement, pixel.x, pixel.y);
      return [
        Math.round(stage.x * resolution * 1000) / 1000,
        Math.round(-stage.y * resolution * 1000) / 1000,
      ];
    },
    heading: (theta: number) => Math.round((theta + turn + layer.yaml.origin[2]) * 1000) / 1000,
  };
};

type Entry = Record<string, unknown>;
type Carry = ReturnType<typeof layerToReference>;

const stepsOf = (mission: Entry): unknown[] => {
  if (Array.isArray(mission['steps'])) return mission['steps'];
  return Array.isArray(mission['locationTagId']) ? mission['locationTagId'] : [];
};

const carryTags = (tags: LocationTag[], into: LocationTag[], carry: Carry) => {
  const ids = new Map<string, number>();
  for (const tag of tags) {
    const id = into.length + 1;
    ids.set(String(tag.id), id);
    const [x, y] = carry.point(tag.x, tag.y);
    into.push({ ...tag, id, x, y, theta: carry.heading(tag.theta ?? 0) });
  }
  return ids;
};

const carryMissions = (missions: Entry[], into: Entry[], tagIds: Map<string, number>) => {
  for (const mission of missions) {
    const id = into.length + 1;
    const steps = stepsOf(mission)
      .map(step => tagIds.get(String(step)))
      .filter((step): step is number => step !== undefined);
    const { locationTagId: _replaced, ...rest } = mission;
    into.push({ ...rest, id, missionId: id, steps });
  }
};

// Tags, zones and paths move with their layer. Robots number tags and missions, so both are
// renumbered across the result and each mission's steps follow its tags.
export const mergeFeatures = (
  layers: (MergeLayer & { features: MapFeatures })[],
  resolution: number
): MapFeatures => {
  const locationTags: LocationTag[] = [];
  const missions: Entry[] = [];
  const zones: MapZone[] = [];
  const paths: MapPath[] = [];
  layers.forEach((layer, index) => {
    const carry = layerToReference(layer, resolution);
    const tagIds = carryTags(layer.features.locationTags ?? [], locationTags, carry);
    carryMissions((layer.features.missions ?? []) as Entry[], missions, tagIds);
    for (const zone of layer.features.zones ?? []) {
      zones.push({
        ...zone,
        id: `z${index}-${zone.id}`,
        polygon: zone.polygon.map(([x, y]) => carry.point(x, y)),
      });
    }
    for (const path of layer.features.paths ?? []) {
      paths.push({
        ...path,
        id: `p${index}-${path.id}`,
        points: path.points.map(([x, y]) => carry.point(x, y)),
      });
    }
  });
  return { locationTags, missions, zones, paths };
};

// A layer placed where its own origin says, so maps made in one frame line up from the start.
export const initialPlacement = (grid: Grid, yaml: MapYaml, reference: MapYaml): Placement => {
  const scale = yaml.resolution / reference.resolution;
  const transforms = {
    width: grid.width,
    height: grid.height,
    resolution: yaml.resolution,
    origin: yaml.origin,
  };
  const topLeft = mapPixelToWorld({ x: 0, y: 0 }, transforms);
  return {
    x: topLeft.x / reference.resolution,
    y: -topLeft.y / reference.resolution,
    rotation: (-yaml.origin[2] * 180) / Math.PI,
    scale,
  };
};
