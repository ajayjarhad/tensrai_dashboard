import { expect, test } from 'bun:test';
import { KEEPOUT, renderKeepoutMask } from './keepoutMask.js';

// 10 × 6 cells of 1 m, origin at (-2, -1): x spans -2..8, y spans -1..5.
const grid = {
  width: 10,
  height: 6,
  resolution: 1,
  origin: [-2, -1, 0] as [number, number, number],
};

const cell = (pgm: Buffer, col: number, row: number) => {
  const header = `P5\n${grid.width} ${grid.height}\n255\n`;
  return pgm[header.length + row * grid.width + col];
};

test('a mask with nothing on it changes nothing: every cell is 255', () => {
  const { pgm } = renderKeepoutMask(grid, {}, 'map4');
  const header = `P5\n10 6\n255\n`;
  expect(pgm.subarray(0, header.length).toString()).toBe(header);
  expect([...pgm.subarray(header.length)].every(value => value === KEEPOUT.noEffect)).toBe(true);
});

test('the yaml is raw mode with the map frame and points at the mask image', () => {
  const { yaml } = renderKeepoutMask(grid, {}, 'map4');
  expect(yaml).toContain('image: keepout_map4.pgm');
  expect(yaml).toContain('mode: raw');
  expect(yaml).toContain('resolution: 1');
  expect(yaml).toContain('origin: [-2, -1, 0]');
});

test('row 0 of the image is the top of the map, so a zone near max y lands in the first rows', () => {
  // World square x 0..2, y 3..5: columns 2..3, top two rows.
  const { pgm } = renderKeepoutMask(
    grid,
    {
      zones: [
        {
          id: 'z',
          type: 'no_go',
          polygon: [
            [0, 3],
            [2, 3],
            [2, 5],
            [0, 5],
          ],
        },
      ],
    },
    'map4'
  );
  expect(cell(pgm, 2, 0)).toBe(KEEPOUT.lethal);
  expect(cell(pgm, 3, 1)).toBe(KEEPOUT.lethal);
  expect(cell(pgm, 2, 5)).toBe(KEEPOUT.noEffect);
  expect(cell(pgm, 6, 0)).toBe(KEEPOUT.noEffect);
});

test('only no-go zones are drawn: work, pick and the rest are information for the robot', () => {
  const { pgm } = renderKeepoutMask(
    grid,
    {
      zones: [
        {
          id: 'w',
          type: 'work',
          polygon: [
            [0, 0],
            [8, 0],
            [8, 5],
            [0, 5],
          ],
        },
      ],
    },
    'map4'
  );
  expect(cell(pgm, 4, 3)).toBe(KEEPOUT.noEffect);
});

test('a virtual wall is lethal along its line, as wide as it says', () => {
  const { pgm } = renderKeepoutMask(
    grid,
    {
      paths: [
        {
          id: 'w',
          type: 'virtual_wall',
          points: [
            [-2, 2.5],
            [8, 2.5],
          ],
          width: 1,
        },
      ],
    },
    'map4'
  );
  // y 2.5 is row 2 counted from the top (y 4..5 is row 0).
  expect(cell(pgm, 0, 2)).toBe(KEEPOUT.lethal);
  expect(cell(pgm, 9, 2)).toBe(KEEPOUT.lethal);
  expect(cell(pgm, 4, 0)).toBe(KEEPOUT.noEffect);
});

test('with preferred paths, cells off the lanes get the lane cost and the lanes stay free', () => {
  const { pgm } = renderKeepoutMask(
    grid,
    {
      preferredLaneCost: 40,
      paths: [
        {
          id: 'p',
          type: 'preferred',
          points: [
            [-2, 0.5],
            [8, 0.5],
          ],
          width: 1,
        },
      ],
    },
    'map4'
  );
  expect(cell(pgm, 5, 4)).toBe(KEEPOUT.noEffect);
  expect(cell(pgm, 5, 0)).toBe(40);
});

test('preferred paths cost nothing extra when the lane cost is unset', () => {
  const { pgm } = renderKeepoutMask(
    grid,
    {
      paths: [
        {
          id: 'p',
          type: 'preferred',
          points: [
            [-2, 0.5],
            [8, 0.5],
          ],
          width: 1,
        },
      ],
    },
    'map4'
  );
  expect(cell(pgm, 5, 0)).toBe(KEEPOUT.noEffect);
});
