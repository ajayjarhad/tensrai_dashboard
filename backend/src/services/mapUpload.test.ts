import { expect, test } from 'bun:test';
import { gzipSync } from 'node:zlib';
import { pgmOf } from './mapImage.js';
import {
  buildMapContent,
  decodeUploadedPgm,
  MapInputError,
  parseMapFeatures,
  parseMapYaml,
  yamlTextOf,
} from './mapUpload.js';

const pgm = (width = 4, height = 3) =>
  Buffer.concat([Buffer.from(`P5\n${width} ${height}\n255\n`), Buffer.alloc(width * height, 254)]);
const gz64 = (bytes: Buffer) => gzipSync(bytes).toString('base64');

const rejection = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    if (error instanceof MapInputError)
      return { code: error.code, status: error.status, message: error.message };
    throw error;
  }
  throw new Error('expected a rejection');
};

test('a gzipped P5 image decodes with its size', () => {
  const { width, height, pgm: bytes } = decodeUploadedPgm(gz64(pgm(4, 3)));
  expect([width, height, bytes.length]).toEqual([4, 3, pgm(4, 3).length]);
});

test('an ascii PGM or a non-gzip upload is refused', () => {
  const ascii = Buffer.from('P2\n2 2\n255\n0 0 0 0\n');
  expect(rejection(() => decodeUploadedPgm(gz64(ascii))).code).toBe('INVALID_IMAGE');
  expect(rejection(() => decodeUploadedPgm(pgm().toString('base64'))).code).toBe('INVALID_IMAGE');
});

test('a gzip bomb stops at the size cap with 413', () => {
  const bomb = gzipSync(Buffer.alloc(16 * 1024 * 1024));
  expect(rejection(() => decodeUploadedPgm(bomb.toString('base64')))).toMatchObject({
    code: 'MAP_TOO_LARGE',
    status: 413,
  });
});

test('the yaml takes only the map_server keys, with yaw 0', () => {
  const ok = parseMapYaml('image: map.pgm\nresolution: 0.05\norigin: [-1, -2, 0]\nmode: trinary\n');
  expect(ok.origin).toEqual([-1, -2, 0]);
  expect(
    rejection(() => parseMapYaml('resolution: 0.05\norigin: [0, 0, 0.12]\n')).message
  ).toContain('yaw must be 0');
  expect(
    rejection(() => parseMapYaml('resolution: 0.05\norigin: [0, 0, 0]\nextra: 1\n')).code
  ).toBe('INVALID_YAML');
  expect(rejection(() => parseMapYaml(': : [')).code).toBe('INVALID_YAML');
});

test('a tag inside a no-go zone is refused, naming both', () => {
  const features = {
    locationTags: [{ id: 7, name: 'Bay 7', x: 1, y: 1 }],
    zones: [
      {
        id: 'z',
        type: 'no_go',
        name: 'Charger bay',
        polygon: [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
        ],
      },
    ],
  };
  expect(rejection(() => parseMapFeatures(features)).message).toBe(
    'Tag “Bay 7” is inside the no-go zone “Charger bay”.'
  );
});

test('string ids are refused until renumbered, and a mission may not lose its tags', () => {
  expect(
    rejection(() => parseMapFeatures({ locationTags: [{ id: 'home', x: 0, y: 0 }] })).code
  ).toBe('NON_INTEGER_IDS');
  expect(
    rejection(() =>
      parseMapFeatures({
        locationTags: [{ id: 1, x: 0, y: 0 }],
        missions: [{ missionId: 2, name: 'Run', locationTagId: [1, 9] }],
      })
    ).code
  ).toBe('TAG_IN_USE');
});

test('features are stored canonical, ready for a round trip through the robot', () => {
  const stored = parseMapFeatures({ missions: [{ missionId: 3, locationTagId: [] }] });
  expect(stored['missions']).toEqual([
    { missionId: 3, locationTagId: [], id: '3', name: 'Mission 3', steps: [] },
  ]);
});

test('map content carries the image hash and a revision; the yaml prints back', async () => {
  const metadata = parseMapYaml('image: map.pgm\nresolution: 0.05\norigin: [-1, -2, 0]\n');
  const content = await buildMapContent(pgm(), metadata, {});
  expect(content.imageSha256).toHaveLength(64);
  expect(content.revision).toHaveLength(64);
  expect(content.pixelWidth).toBe(4);
  expect(yamlTextOf(metadata)).toBe('image: map.pgm\nresolution: 0.05\norigin: [-1, -2, 0]\n');
});

test('a floor over 15 M cells fits one record with its display image, since images are stored gzipped', async () => {
  const floor = pgm(4100, 4000);
  const metadata = parseMapYaml('image: map.pgm\nresolution: 0.05\norigin: [0, 0, 0]\n');
  const content = await buildMapContent(floor, metadata, {});
  expect(content.image.length).toBeLessThan(1024 * 1024);
  expect(pgmOf(content.image)).toEqual(floor);
  expect(content.displayWebpSizeBytes).toBeGreaterThan(0);
});
