import { expect, test } from 'bun:test';
import { canonicalJson, decideRobotCopy, mapRevision } from './mapRevision.js';

const base = {
  imageSha256: 'a'.repeat(64),
  yaml: { image: 'map1.pgm', resolution: 0.05, origin: [-7.5, -11.7, 0], mode: 'trinary' },
  features: { locationTags: [{ id: '1', x: 1, y: 2 }], missions: [] },
};

test('the image filename is not part of a revision, so robots may name their copies freely', () => {
  expect(mapRevision(base)).toBe(
    mapRevision({ ...base, yaml: { ...base.yaml, image: 'map4.pgm' } })
  );
});

test('the image, the yaml and the features each change the revision', () => {
  const revision = mapRevision(base);
  expect(mapRevision({ ...base, imageSha256: 'b'.repeat(64) })).not.toBe(revision);
  expect(mapRevision({ ...base, yaml: { ...base.yaml, resolution: 0.1 } })).not.toBe(revision);
  expect(
    mapRevision({ ...base, features: { ...base.features, missions: [{ id: '3' }] } })
  ).not.toBe(revision);
});

test('key order and undefined values do not matter', () => {
  const reordered = {
    imageSha256: base.imageSha256,
    yaml: { mode: 'trinary', origin: [-7.5, -11.7, 0], resolution: 0.05, extra: undefined },
    features: { missions: [], locationTags: [{ y: 2, x: 1, id: '1' }] },
  };
  expect(mapRevision(reordered)).toBe(mapRevision(base));
});

test('keys sort by code unit, never by the server locale', () => {
  expect(canonicalJson({ b: 1, B: 2, a: 3, Z: 4 })).toBe('{"B":2,"Z":4,"a":3,"b":1}');
});

const rule = (input: Partial<Parameters<typeof decideRobotCopy>[0]>) =>
  decideRobotCopy({
    incomingRev: 'robot',
    currentRev: 'ours',
    pushedRev: 'old',
    edited: true,
    ...input,
  });

test('rule 1: the robot has our revision', () => {
  expect(rule({ incomingRev: 'ours' })).toBe('up_to_date');
  expect(rule({ incomingRev: 'ours', pushedRev: null })).toBe('up_to_date');
});

test('rule 2: the robot still has the revision we last sent', () => {
  expect(rule({ incomingRev: 'old', pushedRev: 'old' })).toBe('behind');
});

test('rule 3: only the robot changed since our last sync', () => {
  expect(rule({ incomingRev: 'robot', pushedRev: 'ours', currentRev: 'ours' })).toBe('take_robot');
});

test('rule 4: both changed is a conflict, never an overwrite', () => {
  expect(rule({ incomingRev: 'robot', pushedRev: 'old', currentRev: 'ours' })).toBe('conflict');
});

test('rule order: an up-to-date robot wins over a stale baseline', () => {
  expect(rule({ incomingRev: 'ours', pushedRev: 'old', currentRev: 'ours' })).toBe('up_to_date');
});

test('a link from before revisions follows its robot unless the map was edited here', () => {
  expect(rule({ pushedRev: null, edited: false })).toBe('take_robot');
  expect(rule({ pushedRev: null, edited: true })).toBe('conflict');
});

test('accepting the robot copy settles a conflict once', () => {
  expect(rule({ acceptRobot: true })).toBe('take_robot');
});
