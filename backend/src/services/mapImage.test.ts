import { expect, test } from 'bun:test';
import { isGzipped, pgmOf, storedImage } from './mapImage.js';

const pgm = Buffer.concat([Buffer.from('P5\n4 3\n255\n'), Buffer.alloc(12, 254)]);

test('an image is stored gzipped and reads back as the PGM', () => {
  const stored = storedImage(pgm);
  expect(isGzipped(stored)).toBe(true);
  expect(pgmOf(stored)).toEqual(pgm);
});

test('a record stored before images were gzipped reads back unchanged', () => {
  expect(isGzipped(pgm)).toBe(false);
  expect(pgmOf(new Uint8Array(pgm))).toEqual(pgm);
});
