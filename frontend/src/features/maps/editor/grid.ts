// The occupancy grid as the editor paints it: the PGM's own bytes, row 0 at the top, so a save
// writes back exactly what was there plus the strokes.

export interface Grid {
  width: number;
  height: number;
  maxVal: number;
  data: Uint8Array;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// One stroke, undoable: the cells it touched, what they held, and the value it painted.
export interface PixelEdit {
  indices: Uint32Array;
  before: Uint8Array;
  value: number;
}

// map_server reads a pixel as occupied near 0 and free near maxVal, or the reverse when negated.
// 254 is what map_saver writes for free space.
export const paintValues = (negate: number | undefined, maxVal: number) => ({
  occupied: negate ? maxVal : 0,
  free: negate ? 0 : maxVal === 255 ? 254 : maxVal,
});

const discOffsets = (size: number) => {
  const radius = (size - 1) / 2;
  const reach = Math.floor(radius);
  const offsets: [number, number][] = [];
  for (let dy = -reach; dy <= reach; dy += 1) {
    for (let dx = -reach; dx <= reach; dx += 1) {
      if (dx * dx + dy * dy <= radius * radius + 0.25) offsets.push([dx, dy]);
    }
  }
  return offsets;
};

// The cells a round brush `size` cells across covers from `from` to `to`, each once.
export const strokeCells = (grid: Grid, from: Point, to: Point, size: number) => {
  const offsets = discOffsets(Math.max(1, Math.round(size)));
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) * 2));
  const cells = new Set<number>();
  for (let step = 0; step <= steps; step += 1) {
    const cx = Math.floor(from.x + ((to.x - from.x) * step) / steps);
    const cy = Math.floor(from.y + ((to.y - from.y) * step) / steps);
    for (const [dx, dy] of offsets) {
      const x = cx + dx;
      const y = cy + dy;
      if (x >= 0 && y >= 0 && x < grid.width && y < grid.height) cells.add(y * grid.width + x);
    }
  }
  return cells;
};

// Paints cells, remembering each cell's first value so the whole stroke undoes as one.
export const paintCells = (
  grid: Grid,
  cells: Iterable<number>,
  value: number,
  touched: Map<number, number>
) => {
  for (const index of cells) {
    if (!touched.has(index)) touched.set(index, grid.data[index] ?? 0);
    grid.data[index] = value;
  }
};

export const toPixelEdit = (touched: Map<number, number>, value: number): PixelEdit => ({
  indices: Uint32Array.from(touched.keys()),
  before: Uint8Array.from(touched.values()),
  value,
});

export const undoPixels = (grid: Grid, edit: PixelEdit) => {
  edit.indices.forEach((index, i) => {
    grid.data[index] = edit.before[i] ?? 0;
  });
};

export const redoPixels = (grid: Grid, edit: PixelEdit) => {
  for (const index of edit.indices) grid.data[index] = edit.value;
};

export const boundsOfCells = (grid: Grid, cells: Iterable<number>): Rect | null => {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = -1;
  let maxY = -1;
  for (const index of cells) {
    const x = index % grid.width;
    const y = Math.floor(index / grid.width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
};

export const clampRect = (grid: Grid, rect: Rect): Rect | null => {
  const x = Math.max(0, Math.floor(Math.min(rect.x, rect.x + rect.width)));
  const y = Math.max(0, Math.floor(Math.min(rect.y, rect.y + rect.height)));
  const right = Math.min(grid.width, Math.ceil(Math.max(rect.x, rect.x + rect.width)));
  const bottom = Math.min(grid.height, Math.ceil(Math.max(rect.y, rect.y + rect.height)));
  return right - x >= 1 && bottom - y >= 1 ? { x, y, width: right - x, height: bottom - y } : null;
};

export const cropGrid = (grid: Grid, rect: Rect): Grid => {
  const data = new Uint8Array(rect.width * rect.height);
  for (let row = 0; row < rect.height; row += 1) {
    const start = (rect.y + row) * grid.width + rect.x;
    data.set(grid.data.subarray(start, start + rect.width), row * rect.width);
  }
  return { width: rect.width, height: rect.height, maxVal: grid.maxVal, data };
};

// The origin is the bottom-left corner in the world; a crop moves it so nothing else moves.
export const croppedOrigin = (
  origin: [number, number, number],
  gridHeight: number,
  resolution: number,
  rect: Rect
): [number, number, number] => [
  origin[0] + rect.x * resolution,
  origin[1] + (gridHeight - rect.y - rect.height) * resolution,
  origin[2],
];

export const encodePgm = (grid: Grid) => {
  const header = new TextEncoder().encode(`P5\n${grid.width} ${grid.height}\n${grid.maxVal}\n`);
  const bytes = new Uint8Array(header.length + grid.data.length);
  bytes.set(header);
  bytes.set(grid.data, header.length);
  return bytes;
};

// Grey levels for display, flipped when negated so occupied space always shows dark.
export const writeRgba = (grid: Grid, negate: number | undefined, image: ImageData, area: Rect) => {
  const scale = 255 / (grid.maxVal || 255);
  for (let row = area.y; row < area.y + area.height; row += 1) {
    for (let col = area.x; col < area.x + area.width; col += 1) {
      const value = (grid.data[row * grid.width + col] ?? 0) * scale;
      const shade = negate ? 255 - value : value;
      const out = ((row - area.y) * area.width + (col - area.x)) * 4;
      image.data[out] = shade;
      image.data[out + 1] = shade;
      image.data[out + 2] = shade;
      image.data[out + 3] = 255;
    }
  }
};
