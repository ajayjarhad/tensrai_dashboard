// Plain 2D geometry in world metres, shared by the backend's keepout raster and the editor.
export type Point = readonly [number, number];

// Ray casting; points exactly on an edge may land on either side.
export const pointInPolygon = ([x, y]: Point, polygon: readonly Point[]) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i] as Point;
    const [xj, yj] = polygon[j] as Point;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

export const distanceToSegment = ([px, py]: Point, [ax, ay]: Point, [bx, by]: Point) => {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

export const distanceToPolyline = (point: Point, line: readonly Point[]) => {
  const [first] = line;
  if (!first) return Number.POSITIVE_INFINITY;
  if (line.length === 1) return distanceToSegment(point, first, first);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < line.length; i += 1) {
    best = Math.min(best, distanceToSegment(point, line[i - 1] as Point, line[i] as Point));
  }
  return best;
};
