import { expect, test } from 'bun:test';
import {
  cropGrid,
  croppedOrigin,
  encodePgm,
  type Grid,
  paintCells,
  paintValues,
  redoPixels,
  strokeCells,
  toPixelEdit,
  undoPixels,
} from '../src/features/maps/editor/grid';
import { parsePGM } from '../src/lib/map/pgm-parser';

const blank = (width = 10, height = 6): Grid => ({
  width,
  height,
  maxVal: 255,
  data: new Uint8Array(width * height).fill(254),
});

const occupiedCells = (grid: Grid) => [...grid.data.keys()].filter(index => grid.data[index] === 0);

test('draw paints occupied cells and the eraser free ones, negated maps the other way round', () => {
  expect(paintValues(0, 255)).toEqual({ occupied: 0, free: 254 });
  expect(paintValues(1, 255)).toEqual({ occupied: 255, free: 0 });
  expect(paintValues(0, 100)).toEqual({ occupied: 0, free: 100 });
});

test('a straight line (Shift-click) covers every cell between the two points', () => {
  const grid = blank();
  paintCells(grid, strokeCells(grid, { x: 0.5, y: 2.5 }, { x: 9.5, y: 2.5 }, 1), 0, new Map());
  expect(occupiedCells(grid)).toEqual([20, 21, 22, 23, 24, 25, 26, 27, 28, 29]);
});

test('a wider brush paints a disc and stays inside the map', () => {
  const grid = blank();
  const cells = strokeCells(grid, { x: 0.2, y: 0.2 }, { x: 0.2, y: 0.2 }, 3);
  expect([...cells].sort((a, b) => a - b)).toEqual([0, 1, 10]);
});

test('a stroke undoes and redoes as one step, even over cells it crossed twice', () => {
  const grid = blank();
  grid.data[21] = 205;
  const touched = new Map<number, number>();
  paintCells(grid, strokeCells(grid, { x: 0.5, y: 2.5 }, { x: 3.5, y: 2.5 }, 1), 0, touched);
  paintCells(grid, strokeCells(grid, { x: 3.5, y: 2.5 }, { x: 0.5, y: 2.5 }, 1), 0, touched);
  const edit = toPixelEdit(touched, 0);
  undoPixels(grid, edit);
  expect(grid.data[21]).toBe(205);
  expect(occupiedCells(grid)).toEqual([]);
  redoPixels(grid, edit);
  expect(occupiedCells(grid)).toEqual([20, 21, 22, 23]);
});

test('a crop keeps the cells inside and moves the origin so the world stays put', () => {
  const grid = blank(4, 3);
  grid.data.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const rect = { x: 1, y: 0, width: 2, height: 2 };
  expect([...cropGrid(grid, rect).data]).toEqual([2, 3, 6, 7]);
  // The cropped image's bottom-left cell was at column 1, row 1 of 3: one cell right, one up.
  expect(croppedOrigin([-1, -2, 0], 3, 0.5, rect)).toEqual([-0.5, -1.5, 0]);
});

test('the saved PGM reads back as the same grid', () => {
  const grid = blank(5, 4);
  grid.data[7] = 0;
  const parsed = parsePGM(encodePgm(grid).buffer as ArrayBuffer);
  expect([parsed.width, parsed.height, parsed.maxVal]).toEqual([5, 4, 255]);
  expect([...parsed.data]).toEqual([...grid.data]);
});
