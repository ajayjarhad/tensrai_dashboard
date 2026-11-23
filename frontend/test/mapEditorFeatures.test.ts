import { expect, test } from 'bun:test';
import {
  addTag,
  addZone,
  cellTransforms,
  headingBetween,
  missionsUsingTag,
  removeFeature,
  toCell,
  toWorld,
} from '../src/features/maps/editor/features';
import type { Grid } from '../src/features/maps/editor/grid';
import { headingToRotation, mapPixelToWorld, worldToMapPixel } from '../src/lib/map/mapTransforms';

const grid: Grid = { width: 200, height: 100, maxVal: 255, data: new Uint8Array(0) };
const transforms = cellTransforms(grid, { resolution: 0.05, origin: [-2, -1, 0] });

test('world and cells convert both ways', () => {
  const cell = toCell([1.5, 2], transforms);
  expect(cell).toEqual({ x: 70, y: 40 });
  expect(toWorld(cell, transforms)).toEqual([1.5, 2]);
  const rotated = { ...transforms, origin: [1, 2, 0.4] as [number, number, number] };
  const back = worldToMapPixel(mapPixelToWorld({ x: 12.5, y: 33 }, rotated), rotated);
  expect([back.x, back.y].map(value => Math.round(value * 1e6) / 1e6)).toEqual([12.5, 33]);
});

test('a heading north points up on screen, and dragging up reads as north', () => {
  expect(headingToRotation(Math.PI / 2)).toBe(-90);
  expect(headingToRotation(0)).toBe(-0);
  expect(headingBetween({ x: 10, y: 10 }, { x: 10, y: 0 })).toBeCloseTo(Math.PI / 2);
  expect(headingBetween({ x: 10, y: 10 }, { x: 0, y: 10 })).toBeCloseTo(Math.PI);
});

test('a new tag takes the next whole-number id, as robots expect', () => {
  const { features, key } = addTag(
    {
      locationTags: [
        { id: 4, x: 0, y: 0 },
        { id: 'home', x: 1, y: 1 },
      ],
    },
    2,
    3,
    0
  );
  expect(key).toBe('tag:5');
  expect(features.locationTags?.at(-1)).toMatchObject({ id: 5, name: 'Tag 5', type: 'mission' });
});

test('zones get a numbered name, and a tag a mission uses is reported', () => {
  const { features } = addZone({}, 'pick', [
    [0, 0],
    [1, 0],
    [1, 1],
  ]);
  expect(features.zones?.[0]?.name).toBe('Pick zone 1');
  const withMission = {
    locationTags: [{ id: 1, x: 0, y: 0 }],
    missions: [{ name: 'Restock', steps: [1] }],
  };
  expect(missionsUsingTag(withMission, '1')).toEqual(['Restock']);
  expect(removeFeature(withMission, 'tag', '1').locationTags).toEqual([]);
});
