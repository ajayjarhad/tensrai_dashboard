import type { MapFeatures, MapYaml } from '@tensrai/shared';
import { create } from 'zustand';
import { type Grid, type PixelEdit, type Point, redoPixels, undoPixels } from './grid';

export type Tool = 'draw' | 'eraser' | 'zone' | 'path' | 'tag';
export const PAINT_TOOLS: ReadonlySet<Tool | null> = new Set<Tool | null>(['draw', 'eraser']);
// Odd sizes, so the brush is centred on the cell under the pointer.
export const BRUSH_SIZES = [1, 3, 5, 9, 15, 25] as const;

// What a press on the canvas does. With no tool the map pans and a click selects; a paint tool
// paints, a shape tool places points. Space or the middle button pans whatever the tool.
export type Gesture = 'pan' | 'paint' | 'place';
export const gestureMode = (tool: Tool | null, spaceHeld: boolean, button = 0): Gesture => {
  if (!tool || spaceHeld || button === 1) return 'pan';
  return PAINT_TOOLS.has(tool) ? 'paint' : 'place';
};

type GridState = { grid: Grid; yaml: MapYaml };

// Strokes keep only the cells they touched; a crop keeps both whole grids, since it is rare.
export type HistoryEntry =
  | { kind: 'pixels'; edit: PixelEdit }
  // `offset` is where the kept area started in the old grid, so the view can keep it in place.
  | { kind: 'grid'; before: GridState; after: GridState; offset: Point }
  | { kind: 'features'; before: MapFeatures; after: MapFeatures }
  | { kind: 'yaml'; before: MapYaml; after: MapYaml };

export type EditedPart = 'pixels' | 'yaml' | 'features';

// A zone, path or tag being placed, in cells; `cursor` trails the pointer for the rubber band.
export interface Draft {
  kind: 'zone' | 'path' | 'tag';
  points: Point[];
  cursor: Point | null;
}
const PARTS: Record<HistoryEntry['kind'], EditedPart[]> = {
  pixels: ['pixels'],
  grid: ['pixels', 'yaml'],
  features: ['features'],
  yaml: ['yaml'],
};

interface EditorState {
  revision: string | null;
  grid: Grid | null;
  yaml: MapYaml | null;
  features: MapFeatures;
  // Bumped whenever the whole image must be redrawn: load, crop, undo and redo.
  gridVersion: number;
  // How far, in cells, the view must move so a crop or its undo leaves the map where it was.
  viewShift: Point & { count: number };
  tool: Tool | null;
  brushSize: number;
  selectedId: string | null;
  draft: Draft | null;
  // Zones, paths and tags hidden from view, to see the map under them.
  featuresHidden: boolean;
  // A world point the view should centre on, bumped by "Show" on a problem.
  focus: { x: number; y: number; count: number };
  past: HistoryEntry[];
  future: HistoryEntry[];
  // History depth at the last save; -1 once that state can't be reached by undo or redo.
  savedDepth: number;
  edited: Set<EditedPart>;
  load: (revision: string | null, grid: Grid, yaml: MapYaml, features: MapFeatures) => void;
  setTool: (tool: Tool | null) => void;
  setBrushSize: (size: number) => void;
  select: (id: string | null) => void;
  setDraft: (draft: Draft | null) => void;
  toggleFeatures: () => void;
  // Live changes while a handle is dragged; the drag commits once, when it ends.
  previewFeatures: (features: MapFeatures) => void;
  focusOn: (point: { x: number; y: number }) => void;
  commit: (entry: HistoryEntry) => void;
  undo: () => void;
  redo: () => void;
  markSaved: (revision: string) => void;
}

const apply = (
  state: EditorState,
  entry: HistoryEntry,
  direction: 'undo' | 'redo'
): Partial<EditorState> => {
  const side = direction === 'undo' ? 'before' : 'after';
  switch (entry.kind) {
    case 'pixels':
      if (state.grid) (direction === 'undo' ? undoPixels : redoPixels)(state.grid, entry.edit);
      return { gridVersion: state.gridVersion + 1 };
    case 'grid': {
      const sign = direction === 'undo' ? -1 : 1;
      return {
        ...entry[side],
        gridVersion: state.gridVersion + 1,
        viewShift: {
          x: sign * entry.offset.x,
          y: sign * entry.offset.y,
          count: state.viewShift.count + 1,
        },
      };
    }
    case 'features':
      return { features: entry[side], selectedId: null };
    case 'yaml':
      return { yaml: entry[side] };
  }
};

export const useEditor = create<EditorState>()((set, get) => ({
  revision: null,
  grid: null,
  yaml: null,
  features: {},
  gridVersion: 0,
  viewShift: { x: 0, y: 0, count: 0 },
  tool: null,
  brushSize: 3,
  selectedId: null,
  draft: null,
  featuresHidden: false,
  focus: { x: 0, y: 0, count: 0 },
  past: [],
  future: [],
  savedDepth: 0,
  edited: new Set(),
  load: (revision, grid, yaml, features) =>
    set(state => ({
      revision,
      grid,
      yaml,
      features,
      gridVersion: state.gridVersion + 1,
      tool: null,
      selectedId: null,
      draft: null,
      past: [],
      future: [],
      savedDepth: 0,
      edited: new Set(),
    })),
  // Putting a tool down keeps the selection, so a shape just placed can be edited at once.
  setTool: tool =>
    set(state => ({
      tool,
      draft: null,
      selectedId: tool ? null : state.selectedId,
      // A shape tool brings hidden shapes back, so new ones aren't drawn blind.
      featuresHidden: tool && !PAINT_TOOLS.has(tool) ? false : state.featuresHidden,
    })),
  setBrushSize: brushSize => set({ brushSize }),
  select: selectedId => set({ selectedId }),
  setDraft: draft => set({ draft }),
  toggleFeatures: () =>
    set(state => ({ featuresHidden: !state.featuresHidden, selectedId: null, draft: null })),
  previewFeatures: features => set({ features }),
  focusOn: point => set(state => ({ focus: { ...point, count: state.focus.count + 1 } })),
  // A stroke is already painted when it is committed; every other entry applies here.
  commit: entry =>
    set(state => ({
      ...(entry.kind === 'pixels' ? {} : apply(state, entry, 'redo')),
      past: [...state.past, entry],
      future: [],
      savedDepth: state.savedDepth > state.past.length ? -1 : state.savedDepth,
      edited: new Set([...state.edited, ...PARTS[entry.kind]]),
    })),
  undo: () => {
    const entry = get().past.at(-1);
    if (!entry) return;
    set(state => ({
      ...apply(state, entry, 'undo'),
      past: state.past.slice(0, -1),
      future: [entry, ...state.future],
      edited: new Set([...state.edited, ...PARTS[entry.kind]]),
    }));
  },
  redo: () => {
    const [entry, ...rest] = get().future;
    if (!entry) return;
    set(state => ({
      ...apply(state, entry, 'redo'),
      past: [...state.past, entry],
      future: rest,
      edited: new Set([...state.edited, ...PARTS[entry.kind]]),
    }));
  },
  markSaved: revision =>
    set(state => ({ revision, savedDepth: state.past.length, edited: new Set() })),
}));

export const isDirty = (state: Pick<EditorState, 'past' | 'savedDepth'>) =>
  state.past.length !== state.savedDepth;
