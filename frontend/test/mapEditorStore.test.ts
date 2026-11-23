import { beforeEach, expect, test } from 'bun:test';
import { gestureMode, isDirty, useEditor } from '../src/features/maps/editor/editorStore';
import type { Grid } from '../src/features/maps/editor/grid';

const grid = (): Grid => ({ width: 2, height: 1, maxVal: 255, data: new Uint8Array([254, 254]) });
const yaml = { resolution: 0.05, origin: [0, 0, 0] as [number, number, number] };

beforeEach(() => useEditor.getState().load('rev-1', grid(), yaml, { locationTags: [] }));

test('with no tool the map pans; a paint tool paints; Space pans whatever the tool', () => {
  expect(gestureMode(null, false)).toBe('pan');
  expect(gestureMode('draw', false)).toBe('paint');
  expect(gestureMode('eraser', true)).toBe('pan');
  expect(gestureMode('zone', false)).toBe('place');
  expect(gestureMode('draw', false, 1)).toBe('pan');
});

test('a stroke undoes and redoes, and undoing back to the save is clean again', () => {
  const editor = useEditor.getState();
  editor.grid?.data.set([0], 0);
  editor.commit({
    kind: 'pixels',
    edit: { indices: Uint32Array.of(0), before: Uint8Array.of(254), value: 0 },
  });
  expect(isDirty(useEditor.getState())).toBe(true);
  useEditor.getState().undo();
  expect(useEditor.getState().grid?.data[0]).toBe(254);
  expect(isDirty(useEditor.getState())).toBe(false);
  useEditor.getState().redo();
  expect(useEditor.getState().grid?.data[0]).toBe(0);
});

test('an edit after undoing past the save can never be clean again by undo', () => {
  const editor = useEditor.getState();
  const yamlEdit = (resolution: number) => ({
    kind: 'yaml' as const,
    before: useEditor.getState().yaml ?? yaml,
    after: { ...yaml, resolution },
  });
  editor.commit(yamlEdit(0.1));
  useEditor.getState().markSaved('rev-2');
  useEditor.getState().undo();
  useEditor.getState().commit(yamlEdit(0.2));
  expect(isDirty(useEditor.getState())).toBe(true);
  useEditor.getState().undo();
  expect(isDirty(useEditor.getState())).toBe(true);
});

test('undoing past a save marks that part for the next save', () => {
  useEditor.getState().commit({ kind: 'features', before: {}, after: { locationTags: [] } });
  useEditor.getState().markSaved('rev-2');
  useEditor.getState().undo();
  expect([...useEditor.getState().edited]).toEqual(['features']);
});
