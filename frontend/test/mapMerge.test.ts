import { expect, test } from 'bun:test';
import type { MapYaml } from '@tensrai/shared';
import type { Grid } from '../src/features/maps/editor/grid';
import { alignTwoPoints, type Placement, toStage } from '../src/features/maps/merge/align';
import {
  initialPlacement,
  MERGED,
  mergeFeatures,
  mergeGrids,
} from '../src/features/maps/merge/merge';

const grid = (width: number, height: number, values: number[]): Grid => ({
  width,
  height,
  maxVal: 255,
  data: Uint8Array.from(values),
});
const yaml = (resolution: number, origin: [number, number, number]): MapYaml => ({
  resolution,
  origin,
});
const { occupied: O, free: F, unknown: U } = MERGED;

test('two point pairs carry a turned, shifted layer back onto the reference', () => {
  const truth: Placement = { x: 40, y: -12, rotation: 0, scale: 1 };
  const moving: Placement = { x: 55, y: 3, rotation: 30, scale: 1 };
  const p1 = toStage(moving, 2, 3);
  const p2 = toStage(moving, 20, 9);
  const { move, residuals } = alignTwoPoints(p1, toStage(truth, 2, 3), p2, toStage(truth, 20, 9));
  const lined = move(moving);
  expect([lined.x, lined.y, lined.rotation].map(value => Math.round(value * 1e6) / 1e6)).toEqual([
    40, -12, 0,
  ]);
  expect(Math.max(...residuals)).toBeLessThan(1e-9);
});

test('a map alone merges into itself, origin kept', () => {
  const reference = { grid: grid(4, 2, [F, F, O, F, F, U, F, F]), yaml: yaml(0.5, [-1, -2, 0]) };
  const placement = initialPlacement(reference.grid, reference.yaml, reference.yaml);
  const { grid: out, yaml: outYaml } = mergeGrids([{ ...reference, placement }], 0.5);
  expect([...out.data]).toEqual([F, F, O, F, F, U, F, F]);
  expect(outYaml.origin).toEqual([-1, -2, 0]);
});

test('the top layer wins where it knows the space, the one under it elsewhere', () => {
  const reference = { grid: grid(4, 1, [F, F, F, F]), yaml: yaml(1, [0, 0, 0]) };
  const top = { grid: grid(2, 1, [O, U]), yaml: yaml(1, [3, 0, 0]) };
  const layers = [reference, top].map(layer => ({
    ...layer,
    placement: initialPlacement(layer.grid, layer.yaml, reference.yaml),
  }));
  const { grid: out } = mergeGrids(layers, 1);
  // The top layer starts at x = 3: it overrides cell 3 and adds cell 4, which it doesn't know.
  expect([...out.data]).toEqual([F, F, F, O, U]);
});

test('a coarser layer covers as many reference cells as it is larger', () => {
  const reference = { grid: grid(1, 1, [U]), yaml: yaml(0.05, [0, 0, 0]) };
  const coarse = { grid: grid(1, 1, [O]), yaml: yaml(0.1, [0, 0, 0]) };
  const layers = [reference, coarse].map(layer => ({
    ...layer,
    placement: initialPlacement(layer.grid, layer.yaml, reference.yaml),
  }));
  const { grid: out } = mergeGrids(layers, 0.05);
  expect([out.width, out.height]).toEqual([2, 2]);
  expect([...out.data]).toEqual([O, O, O, O]);
});

test('tags and missions are renumbered across layers and steps follow their tags', () => {
  const reference = { grid: grid(10, 10, new Array(100).fill(F)), yaml: yaml(1, [0, 0, 0]) };
  const features = {
    locationTags: [{ id: 1, name: 'Dock', x: 2, y: 3, theta: 0 }],
    missions: [{ missionId: 1, name: 'Run', locationTagId: [1] }],
    zones: [
      {
        id: 'z',
        type: 'no_go' as const,
        polygon: [
          [0, 0],
          [1, 0],
          [1, 1],
        ] as [number, number][],
      },
    ],
  };
  const shifted: Placement = {
    ...initialPlacement(reference.grid, reference.yaml, reference.yaml),
  };
  shifted.x += 10;
  const merged = mergeFeatures(
    [
      {
        ...reference,
        features,
        placement: initialPlacement(reference.grid, reference.yaml, reference.yaml),
      },
      { ...reference, features, placement: shifted },
    ],
    1
  );
  expect(merged.locationTags?.map(tag => [tag.id, tag.x, tag.y])).toEqual([
    [1, 2, 3],
    [2, 12, 3],
  ]);
  expect(merged.missions?.map(mission => [mission['missionId'], mission['steps']])).toEqual([
    [1, [1]],
    [2, [2]],
  ]);
  expect(merged.zones?.map(zone => zone.id)).toEqual(['z0-z', 'z1-z']);
});

test("the readout gives a layer's origin in the reference map and its turn", async () => {
  const { layerPose } = await import('../src/features/maps/merge/MergeCanvas');
  const reference = { grid: grid(10, 4, new Array(40).fill(F)), yaml: yaml(0.5, [2, 3, 0]) };
  const placement = initialPlacement(reference.grid, reference.yaml, reference.yaml);
  const layer = {
    ...reference,
    placement,
    key: 'k',
    name: 'A',
    source: '',
    features: {},
    opacity: 1,
    visible: true,
  };
  expect(layerPose(layer, 0.5)).toEqual({ x: 2, y: 3, degrees: 0 });
  expect(layerPose({ ...layer, placement: { ...placement, rotation: 30 } }, 0.5).degrees).toBe(-30);
});
