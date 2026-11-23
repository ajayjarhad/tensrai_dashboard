// Layer placement on the merge canvas. Everything is in "stage" units: the reference map's
// pixels, x right and y down, so one unit is the reference resolution in metres.

export interface StagePoint {
  x: number;
  y: number;
}

// Where a layer's image sits: its top-left corner, its turn in degrees (clockwise on screen, as
// Konva draws it) and its pixel size relative to the reference.
export interface Placement {
  x: number;
  y: number;
  rotation: number;
  scale: number;
}

const radians = (degrees: number) => (degrees * Math.PI) / 180;

export const toStage = (placement: Placement, u: number, v: number): StagePoint => {
  const angle = radians(placement.rotation);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: placement.x + placement.scale * (u * cos - v * sin),
    y: placement.y + placement.scale * (u * sin + v * cos),
  };
};

export const toLayer = (placement: Placement, point: StagePoint): StagePoint => {
  const angle = radians(placement.rotation);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = (point.x - placement.x) / placement.scale;
  const dy = (point.y - placement.y) / placement.scale;
  return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
};

// Turns a placement about a stage point, as the round handle does.
export const turnAbout = (placement: Placement, pivot: StagePoint, degrees: number): Placement => {
  const angle = radians(degrees);
  const dx = placement.x - pivot.x;
  const dy = placement.y - pivot.y;
  return {
    ...placement,
    x: pivot.x + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: pivot.y + dx * Math.sin(angle) + dy * Math.cos(angle),
    rotation: placement.rotation + degrees,
  };
};

// "Line up by two points": the turn and shift that carry p1 and p2 (a feature as the moving layer
// shows it) onto q1 and q2 (the same feature on the reference). Two pairs fix a rigid move; what
// is left over at each pair says how well they agree.
export const alignTwoPoints = (p1: StagePoint, q1: StagePoint, p2: StagePoint, q2: StagePoint) => {
  const degrees =
    ((Math.atan2(q2.y - q1.y, q2.x - q1.x) - Math.atan2(p2.y - p1.y, p2.x - p1.x)) * 180) / Math.PI;
  const pMid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const qMid = { x: (q1.x + q2.x) / 2, y: (q1.y + q2.y) / 2 };
  const move = (placement: Placement): Placement => {
    const turned = turnAbout(placement, pMid, degrees);
    return { ...turned, x: turned.x + qMid.x - pMid.x, y: turned.y + qMid.y - pMid.y };
  };
  const moved = (point: StagePoint) => {
    const identity = { x: point.x, y: point.y, rotation: 0, scale: 1 };
    const result = move(identity);
    return { x: result.x, y: result.y };
  };
  const residuals = [
    [p1, q1],
    [p2, q2],
  ].map(([from, to]) => {
    const at = moved(from as StagePoint);
    return Math.hypot(at.x - (to as StagePoint).x, at.y - (to as StagePoint).y);
  });
  return { move, residuals };
};
