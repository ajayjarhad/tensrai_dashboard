import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { canonicalJson } from './mapRevision.js';
import { normalizeFeatures } from './mapSyncPayload.js';
import {
  canonicalFeatures,
  missionIdConflicts,
  nonIntegerIds,
  renumberIds,
  toRobotMetadata,
} from './robotMetadata.js';

const robotFile = JSON.parse(
  readFileSync(new URL('../../../dashboard_ros/maps/metadata1.json', import.meta.url), 'utf8')
);

test("the robot's own metadata survives a dashboard round trip", () => {
  const imported = normalizeFeatures(robotFile);
  const sent = toRobotMetadata(imported);

  expect(sent['missions']).toEqual(robotFile.missions);
  expect(sent['locationTags']).toEqual(robotFile.locationTags);
  expect(canonicalJson(normalizeFeatures(sent))).toBe(canonicalJson(imported));
});

test('a saved map imports back to the exact features it was saved with', () => {
  const edited = {
    ...normalizeFeatures(robotFile),
    zones: [
      {
        id: 'z1',
        type: 'pick',
        name: 'Lane A',
        polygon: [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
      },
    ],
    paths: [
      {
        id: 'p1',
        type: 'preferred',
        points: [
          [0, 0],
          [2, 0],
        ],
        width: 0.8,
      },
    ],
  };
  const stored = canonicalFeatures(edited);

  expect(canonicalJson(normalizeFeatures(toRobotMetadata(stored)))).toBe(canonicalJson(stored));
});

test('missions go to the robot as missionId and locationTagId integers', () => {
  const sent = toRobotMetadata({ missions: [{ id: '7', name: 'Patrol', steps: ['2', '3'] }] });
  expect(sent['missions']).toEqual([{ name: 'Patrol', missionId: 7, locationTagId: [2, 3] }]);
});

test('non-integer ids are found, and renumbering fixes them and the steps that use them', () => {
  const seed = {
    locationTags: [
      { id: 'home', x: 0, y: 0 },
      { id: '4', x: 1, y: 1 },
    ],
    missions: [{ id: 'patrol', name: 'Patrol', steps: ['home', '4'] }],
  };
  expect(nonIntegerIds(seed)).toEqual({ tags: ['home'], missions: ['patrol'] });

  const fixed = renumberIds(seed) as {
    locationTags: { id: string }[];
    missions: { steps: string[] }[];
  };
  expect(nonIntegerIds(fixed)).toEqual({ tags: [], missions: [] });
  expect(fixed.locationTags.map(tag => tag.id)).toEqual(['5', '4']);
  expect(fixed.missions[0]?.steps).toEqual(['5', '4']);
});

test('mission ids another map on the robot uses are clashes, and renumbering clears them', () => {
  const ours = {
    missions: [
      { missionId: 3, locationTagId: [1] },
      { missionId: 9, locationTagId: [] },
    ],
  };
  const theirs = { missions: [{ missionId: 3, locationTagId: [2] }] };

  expect(missionIdConflicts(ours, [theirs])).toEqual([3]);
  expect(missionIdConflicts(renumberIds(ours, [3]), [theirs])).toEqual([]);
});
