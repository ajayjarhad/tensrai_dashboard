import type { MapFeatures } from '@tensrai/shared';
import { useEditor } from './editorStore';
import { addPath, addTag, addZone, cellTransforms, headingBetween, toWorld } from './features';
import type { Point } from './grid';

// Placing zones, paths and tags with the pointer. `tolerance` is in cells: a few screen pixels at
// the current zoom.

const near = (a: Point | undefined, b: Point, tolerance: number) =>
  Boolean(a) && Math.hypot((a?.x ?? 0) - b.x, (a?.y ?? 0) - b.y) <= tolerance;

const commitAdded = ({ features, key }: { features: MapFeatures; key: string }) => {
  const editor = useEditor.getState();
  editor.commit({ kind: 'features', before: editor.features, after: features });
  useEditor.setState({ selectedId: key, draft: null });
};

// Ends a zone or path; a double-click or a click on the first vertex lands here too, so
// repeated points are dropped first.
export const finishDraft = (tolerance: number) => {
  const { draft, grid, yaml, features } = useEditor.getState();
  if (!draft || draft.kind === 'tag' || !grid || !yaml) return false;
  const points = draft.points.filter(
    (point, index) => !near(draft.points[index - 1], point, tolerance)
  );
  const transforms = cellTransforms(grid, yaml);
  const world = points.map(point => toWorld(point, transforms));
  if (draft.kind === 'zone' && world.length >= 3) {
    commitAdded(addZone(features, 'no_go', world));
    return true;
  }
  if (draft.kind === 'path' && world.length >= 2) {
    commitAdded(addPath(features, 'preferred', world));
    return true;
  }
  return false;
};

// Konva reports any two clicks within 400 ms as a double-click, wherever they land; only two on
// one spot finish the shape.
export const finishOnDoubleClick = (tolerance: number) => {
  const points = useEditor.getState().draft?.points ?? [];
  const [before, last] = points.slice(-2);
  if (last && near(before, last, tolerance)) finishDraft(tolerance);
};

export const placeDown = (cell: Point, tolerance: number) => {
  const { tool, draft, setDraft } = useEditor.getState();
  if (tool === 'tag') {
    setDraft({ kind: 'tag', points: [cell], cursor: cell });
    return;
  }
  if (tool !== 'zone' && tool !== 'path') return;
  const current = draft?.kind === tool ? draft : { kind: tool, points: [], cursor: cell };
  if (tool === 'zone' && current.points.length >= 3 && near(current.points[0], cell, tolerance)) {
    finishDraft(tolerance);
    return;
  }
  setDraft({ ...current, points: [...current.points, cell], cursor: cell });
};

export const placeMove = (cell: Point) => {
  const { draft, setDraft } = useEditor.getState();
  if (draft) setDraft({ ...draft, cursor: cell });
};

// A tag goes where the press began, facing where the pointer was released.
export const placeUp = (cell: Point, tolerance: number) => {
  const { draft, grid, yaml, features } = useEditor.getState();
  const start = draft?.kind === 'tag' ? draft.points[0] : undefined;
  if (!start || !grid || !yaml) return;
  const theta = near(start, cell, tolerance) ? 0 : headingBetween(start, cell, yaml.origin[2]);
  const [x, y] = toWorld(start, cellTransforms(grid, yaml));
  commitAdded(addTag(features, x, y, Math.round(theta * 1000) / 1000));
};

export const dropLastPoint = () => {
  const { draft, setDraft } = useEditor.getState();
  if (!draft) return false;
  setDraft(draft.points.length > 1 ? { ...draft, points: draft.points.slice(0, -1) } : null);
  return true;
};
