import { expect, test } from 'bun:test';
import { parsePGM } from '../src/lib/map/pgm-parser';

const pgm = (header: string, pixels: number[]) => {
  const bytes = new Uint8Array([...new TextEncoder().encode(header), ...pixels]);
  return bytes.buffer;
};

test('reads the size, maximum and pixels of a binary PGM', () => {
  const parsed = parsePGM(pgm('P5\n2 2\n100\n', [0, 50, 100, 25]));

  expect([parsed.width, parsed.height, parsed.maxVal]).toEqual([2, 2, 100]);
  expect([...parsed.data]).toEqual([0, 50, 100, 25]);
});

test('skips header comments, wherever they appear', () => {
  const parsed = parsePGM(pgm('P5\n# CREATOR: GIMP\n2 # width\n2\n255\n', [1, 2, 3, 4]));

  expect([parsed.width, parsed.height, parsed.maxVal]).toEqual([2, 2, 255]);
  expect([...parsed.data]).toEqual([1, 2, 3, 4]);
});

test('keeps pixels whose value is a whitespace or comment byte', () => {
  const pixels = [10, 32, 9, 35];

  expect([...parsePGM(pgm('P5\n2 2\n255\n', pixels)).data]).toEqual(pixels);
});

test('rejects anything other than binary PGM', () => {
  expect(() => parsePGM(pgm('P2\n2 2\n255\n', []))).toThrow('Unsupported PGM format');
});
