import { distanceToPolyline, isRecord, type Point, pointInPolygon } from '@tensrai/shared';

// Nav2 KeepoutFilter mask in raw mode: a pixel of 0–100 is that occupancy value and 101–255 is
// unknown, which the filter skips. 255 therefore means "no effect"; 0 would not, because the filter
// writes mask values over unknown costmap cells and 0 would turn them into free space.
export const KEEPOUT = { noEffect: 255, lethal: 100 } as const;

export interface MaskGrid {
  width: number;
  height: number;
  resolution: number;
  origin: readonly [number, number, number];
}

type Shape = Record<string, unknown>;

const shapes = (value: unknown, kind: string): Shape[] =>
  Array.isArray(value) ? value.filter(isRecord).filter(shape => shape['type'] === kind) : [];

const pointsOf = (value: unknown): Point[] =>
  Array.isArray(value)
    ? value.filter(
        (point): point is Point =>
          Array.isArray(point) && typeof point[0] === 'number' && typeof point[1] === 'number'
      )
    : [];

// Row 0 of a PGM is the top of the map, the largest y.
const cellCenter = (grid: MaskGrid, col: number, row: number): Point => [
  grid.origin[0] + (col + 0.5) * grid.resolution,
  grid.origin[1] + (grid.height - row - 0.5) * grid.resolution,
];

// Visits each cell whose centre lies within the shape's bounding box, grown by `margin` metres.
const forEachCellNear = (
  grid: MaskGrid,
  points: Point[],
  margin: number,
  visit: (index: number, center: Point) => void
) => {
  const xs = points.map(point => point[0]);
  const ys = points.map(point => point[1]);
  const colFrom = Math.max(
    0,
    Math.floor((Math.min(...xs) - margin - grid.origin[0]) / grid.resolution)
  );
  const colTo = Math.min(
    grid.width - 1,
    Math.ceil((Math.max(...xs) + margin - grid.origin[0]) / grid.resolution)
  );
  const rowFrom = Math.max(
    0,
    grid.height - Math.ceil((Math.max(...ys) + margin - grid.origin[1]) / grid.resolution)
  );
  const rowTo = Math.min(
    grid.height - 1,
    grid.height - Math.floor((Math.min(...ys) - margin - grid.origin[1]) / grid.resolution)
  );
  for (let row = rowFrom; row <= rowTo; row += 1) {
    for (let col = colFrom; col <= colTo; col += 1) {
      visit(row * grid.width + col, cellCenter(grid, col, row));
    }
  }
};

const fillPolygon = (grid: MaskGrid, data: Uint8Array, polygon: Point[], value: number) => {
  if (polygon.length < 3) return;
  forEachCellNear(grid, polygon, 0, (index, center) => {
    if (pointInPolygon(center, polygon)) data[index] = value;
  });
};

const fillLine = (
  grid: MaskGrid,
  data: Uint8Array,
  line: Point[],
  width: number,
  value: number
) => {
  if (line.length === 0) return;
  // At least one cell wide, so a thin wall can't slip between cell centres.
  const reach = Math.max(width, grid.resolution) / 2;
  forEachCellNear(grid, line, reach, (index, center) => {
    if (distanceToPolyline(center, line) <= reach) data[index] = value;
  });
};

// ponytail: one pass per shape over its bounding box with a point test per cell. Fine for hundreds of
// shapes on a few million cells; scanline fill if maps or shape counts grow by orders of magnitude.
export const renderKeepoutMask = (grid: MaskGrid, features: unknown, stem: string) => {
  const source = isRecord(features) ? features : {};
  const data = new Uint8Array(grid.width * grid.height).fill(KEEPOUT.noEffect);

  const lanes = shapes(source['paths'], 'preferred');
  const laneCost = Number(source['preferredLaneCost'] ?? 0);
  if (lanes.length > 0 && laneCost >= 1 && laneCost <= 99) {
    data.fill(laneCost);
    for (const lane of lanes) {
      fillLine(grid, data, pointsOf(lane['points']), Number(lane['width'] ?? 0), KEEPOUT.noEffect);
    }
  }
  for (const zone of shapes(source['zones'], 'no_go')) {
    fillPolygon(grid, data, pointsOf(zone['polygon']), KEEPOUT.lethal);
  }
  for (const wall of shapes(source['paths'], 'virtual_wall')) {
    fillLine(grid, data, pointsOf(wall['points']), Number(wall['width'] ?? 0), KEEPOUT.lethal);
  }

  const header = Buffer.from(`P5\n${grid.width} ${grid.height}\n255\n`, 'ascii');
  const [x, y] = grid.origin;
  const yaml = [
    `image: keepout_${stem}.pgm`,
    'mode: raw',
    `resolution: ${grid.resolution}`,
    `origin: [${x}, ${y}, 0]`,
    'negate: 0',
    'occupied_thresh: 0.65',
    'free_thresh: 0.25',
    '',
  ].join('\n');
  return { yaml, pgm: Buffer.concat([header, Buffer.from(data)]) };
};
