import { useQuery } from '@tanstack/react-query';
import { Link, useBlocker, useNavigate, useParams } from '@tanstack/react-router';
import { mapFeatureProblem } from '@tensrai/shared';
import { dump } from 'js-yaml';
import { ArrowLeft, Crop, Download, FileCode, Redo2, Save, Send, Undo2 } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useDetailsDismiss } from '@/hooks/useDetailsDismiss';
import { queryKeys } from '@/lib/query-keys';
import { errorCodeOf, errorMessageOf, gzipBase64, type MapDetail, mapsApi } from '../api';
import { loadMapContent } from '../loadMap';
import { useRefreshMaps } from '../queries';
import { EditorCanvas } from './EditorCanvas';
import { BRUSH_SIZES, isDirty, PAINT_TOOLS, useEditor } from './editorStore';
import { cropGrid, croppedOrigin, encodePgm, type Grid, type Rect } from './grid';
import { dropLastPoint, finishDraft } from './placement';
import { deleteSelected } from './ShapeCard';
import { BrushOptions, PAINT_TOOL_SPECS, SHAPE_TOOL_SPECS, ToolButton, ToolRail } from './ToolRail';
import { YamlDialog } from './YamlDialog';

const yamlText = (yaml: object) => dump(yaml, { flowLevel: 1 });
const pgmBlob = (grid: Grid) => new Blob([encodePgm(grid)], { type: 'image/x-portable-graymap' });

// Only what changed travels, and every save names the revision it was made on.
const editBody = async () => {
  const { revision, edited, grid, yaml, features } = useEditor.getState();
  return {
    baseRevision: revision,
    ...(edited.has('pixels') && grid ? { pgmGzipBase64: await gzipBase64(pgmBlob(grid)) } : {}),
    ...(edited.has('yaml') && yaml ? { yaml: yamlText(yaml) } : {}),
    ...(edited.has('features') ? { features } : {}),
  };
};

const saveFile = (name: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

interface ShortcutActions {
  save: () => void;
  cancel: () => void;
  paintAllowed: boolean;
}

const commandShortcut = (key: string, shift: boolean, actions: ShortcutActions) => {
  const editor = useEditor.getState();
  const handlers: Record<string, () => void> = {
    s: actions.save,
    y: editor.redo,
    z: shift ? editor.redo : editor.undo,
  };
  return handlers[key];
};

const plainShortcut = (key: string, actions: ShortcutActions) => {
  const editor = useEditor.getState();
  const resize = (by: number) => () => {
    const index = BRUSH_SIZES.indexOf(editor.brushSize as (typeof BRUSH_SIZES)[number]);
    const next = BRUSH_SIZES[index + by];
    if (next) editor.setBrushSize(next);
  };
  const paint = (tool: 'draw' | 'eraser') =>
    actions.paintAllowed ? () => editor.setTool(tool) : undefined;
  const removeOrBack = () => {
    if (dropLastPoint()) return;
    const refusal = deleteSelected();
    if (refusal) toast.error(refusal);
  };
  const handlers: Record<string, (() => void) | undefined> = {
    b: paint('draw'),
    e: paint('eraser'),
    z: () => editor.setTool('zone'),
    p: () => editor.setTool('path'),
    t: () => editor.setTool('tag'),
    enter: () => finishDraft(0),
    backspace: removeOrBack,
    delete: removeOrBack,
    escape: actions.cancel,
    '[': resize(-1),
    ']': resize(1),
  };
  return handlers[key];
};

function useEditorShortcuts(actions: ShortcutActions) {
  const latest = useRef(actions);
  latest.current = actions;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || document.querySelector('[role="dialog"]')) return;
      const key = event.key.toLowerCase();
      const command = event.metaKey || event.ctrlKey;
      const handler = command
        ? commandShortcut(key, event.shiftKey, latest.current)
        : plainShortcut(key, latest.current);
      if (!handler) return;
      if (command) event.preventDefault();
      handler();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function MoreMenu({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useDetailsDismiss(ref);
  return (
    <details ref={ref} className="relative">
      <summary
        aria-label="More"
        title="Crop map, map YAML, download"
        className="grid h-8 w-8 cursor-pointer list-none place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-ring-strong [&::-webkit-details-marker]:hidden"
      >
        <span aria-hidden className="text-lg leading-none">
          ⋯
        </span>
      </summary>
      <div
        role="menu"
        className="absolute right-0 top-[calc(100%+8px)] z-30 grid min-w-[232px] gap-0.5 rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-md"
      >
        {children}
      </div>
    </details>
  );
}

function MenuItem({
  icon,
  label,
  onSelect,
}: {
  icon: ReactNode;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted focus-ring-strong [&_svg]:h-4 [&_svg]:w-4"
    >
      {icon}
      {label}
    </button>
  );
}

function TopBar({
  detail,
  saving,
  blocked,
  onSave,
  onSync,
  menu,
}: {
  detail: MapDetail;
  saving: boolean;
  blocked: boolean;
  onSave: () => void;
  onSync: () => void;
  menu: ReactNode;
}) {
  const dirty = useEditor(isDirty);
  const canUndo = useEditor(state => state.past.length > 0);
  const canRedo = useEditor(state => state.future.length > 0);
  const undo = useEditor(state => state.undo);
  const redo = useEditor(state => state.redo);
  return (
    <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card pl-2 pr-4">
      <Link
        to="/maps"
        aria-label="Back to Maps"
        title="Back to Maps"
        className="grid h-10 w-10 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-ring-strong"
      >
        <ArrowLeft className="h-5 w-5" aria-hidden />
      </Link>
      <h1 className="truncate text-base font-semibold">{detail.name}</h1>
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] text-muted-foreground">
        <span
          aria-hidden
          className={
            dirty
              ? 'h-2 w-2 rounded-full bg-status-warning'
              : 'h-2 w-2 rounded-full bg-status-online'
          }
        />
        {dirty ? 'Unsaved changes' : 'Saved'}
      </span>
      <span className="flex-1" />
      <ToolButton small label="Undo" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
        <Undo2 aria-hidden />
      </ToolButton>
      <ToolButton small label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}>
        <Redo2 aria-hidden />
      </ToolButton>
      <span className="mx-2 h-6 w-px bg-border" />
      <Button
        variant="outline"
        className="border-input-strong"
        disabled={dirty || detail.robots.length === 0}
        title={
          dirty
            ? 'Save first: Sync sends the saved version'
            : detail.robots.length === 0
              ? 'No robot has this map yet. Assign it from the Maps page.'
              : 'Send the saved version to its robots'
        }
        onClick={onSync}
      >
        <Send aria-hidden />
        Sync
      </Button>
      <Button disabled={!dirty || saving || blocked} onClick={onSave}>
        <Save aria-hidden />
        {saving ? 'Saving…' : 'Save'}
      </Button>
      {menu}
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <output className="absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-2.5 rounded-xl border border-border bg-card py-2 pl-3 pr-2 text-[13px] shadow-md">
      {children}
    </output>
  );
}

const TOOL_HINT: Partial<Record<string, string>> = {
  zone: 'Click to add corners. Click the first one, or press Enter, to close the zone.',
  path: 'Click to add points. Double-click, or press Enter, to finish the path.',
  tag: 'Click to place a tag. Drag before letting go to set the way it faces.',
};

export function MapEditorPage() {
  const { mapId = '' } = useParams({ strict: false }) as { mapId?: string };
  const navigate = useNavigate();
  const refreshMaps = useRefreshMaps();
  const query = useQuery({
    queryKey: [...queryKeys.maps.detail(mapId), 'editor'],
    queryFn: () => loadMapContent(mapId),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const load = useEditor(state => state.load);
  const yaml = useEditor(state => state.yaml);
  const tool = useEditor(state => state.tool);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [yamlOpen, setYamlOpen] = useState(false);
  const [crop, setCrop] = useState<{ rect: Rect | null } | null>(null);
  const features = useEditor(state => state.features);
  const problem = useMemo(() => mapFeatureProblem(features), [features]);

  useEffect(() => {
    if (!query.data) return;
    const { detail, grid } = query.data;
    load(detail.revision, grid, detail.metadata, detail.features ?? {});
  }, [query.data, load]);

  useBlocker({
    shouldBlockFn: () =>
      isDirty(useEditor.getState()) &&
      !window.confirm('Leave without saving? Your edits to this map will be lost.'),
    enableBeforeUnload: () => isDirty(useEditor.getState()),
  });

  const paintDisabledReason =
    yaml?.mode === 'raw' ? 'This map stores raw values, so Draw and Eraser are off.' : null;

  const save = async () => {
    if (!isDirty(useEditor.getState()) || saving || problem) return;
    setSaving(true);
    try {
      const { data } = await mapsApi.update(mapId, await editBody());
      useEditor.getState().markSaved(data.revision ?? '');
      toast.success('Saved');
      void refreshMaps();
    } catch (error) {
      if ((await errorCodeOf(error)) === 'MAP_CHANGED') setConflict(true);
      else toast.error(errorMessageOf(error, "Couldn't save the map."));
    } finally {
      setSaving(false);
    }
  };

  const saveAsNew = async () => {
    const { grid, yaml: current, features } = useEditor.getState();
    if (!grid || !current || !query.data) return;
    try {
      const { data } = await mapsApi.upload({
        name: `${query.data.detail.name} (copy)`.slice(0, 100),
        yaml: yamlText(current),
        pgmGzipBase64: await gzipBase64(pgmBlob(grid)),
        features,
      });
      useEditor.getState().markSaved(data.revision ?? '');
      setConflict(false);
      void refreshMaps();
      await navigate({ to: '/maps/$mapId/edit', params: { mapId: data.id } });
    } catch (error) {
      toast.error(errorMessageOf(error, "Couldn't save a copy."));
    }
  };

  const sync = async () => {
    try {
      const results = await mapsApi.push(mapId);
      const refused = results.filter(result => !result.started);
      for (const result of refused) toast.error(result.error ?? 'The sync did not start.');
      if (results.length > refused.length) toast.success('Syncing. The Maps page shows progress.');
      void refreshMaps();
    } catch (error) {
      toast.error(errorMessageOf(error, 'The sync did not start.'));
    }
  };

  const applyCrop = () => {
    const editor = useEditor.getState();
    if (!editor.grid || !editor.yaml || !crop?.rect) return;
    const origin = croppedOrigin(
      editor.yaml.origin,
      editor.grid.height,
      editor.yaml.resolution,
      crop.rect
    );
    editor.commit({
      kind: 'grid',
      before: { grid: editor.grid, yaml: editor.yaml },
      after: { grid: cropGrid(editor.grid, crop.rect), yaml: { ...editor.yaml, origin } },
      offset: { x: crop.rect.x, y: crop.rect.y },
    });
    setCrop(null);
  };

  const download = () => {
    const { grid, yaml: current } = useEditor.getState();
    const stem = query.data?.detail.filename.replace(/\.ya?ml$/i, '') ?? 'map';
    if (!grid || !current) return;
    saveFile(`${stem}.pgm`, pgmBlob(grid));
    saveFile(`${stem}.yaml`, new Blob([yamlText({ ...current, image: `${stem}.pgm` })]));
  };

  useEditorShortcuts({
    save: () => void save(),
    cancel: () => {
      const editor = useEditor.getState();
      if (editor.draft) editor.setDraft(null);
      else if (crop) setCrop(null);
      else if (editor.tool) editor.setTool(null);
      else editor.select(null);
    },
    paintAllowed: !paintDisabledReason,
  });

  if (query.isError) {
    return (
      <div className="p-8 text-sm">
        Couldn't open this map.{' '}
        <Link to="/maps" className="font-medium text-link underline">
          Back to Maps
        </Link>
      </div>
    );
  }
  if (!query.data || !yaml) {
    return <p className="p-8 text-sm text-muted-foreground">Loading the map…</p>;
  }

  return (
    <>
      <div className="p-8 text-sm md:hidden">
        The map editor needs a larger screen. Open it on a tablet or a computer.
      </div>
      <div className="hidden h-full min-h-0 flex-col md:flex">
        <TopBar
          detail={query.data.detail}
          saving={saving}
          blocked={Boolean(problem)}
          onSave={() => void save()}
          onSync={() => void sync()}
          menu={
            <MoreMenu>
              <MenuItem
                icon={<Crop aria-hidden />}
                label="Crop map"
                onSelect={() => {
                  useEditor.getState().setTool(null);
                  setCrop({ rect: null });
                }}
              />
              <MenuItem
                icon={<FileCode aria-hidden />}
                label="Map YAML"
                onSelect={() => setYamlOpen(true)}
              />
              <MenuItem
                icon={<Download aria-hidden />}
                label="Download map files"
                onSelect={download}
              />
            </MoreMenu>
          }
        />
        <EditorCanvas
          crop={{
            active: Boolean(crop),
            rect: crop?.rect ?? null,
            onChange: rect => setCrop({ rect }),
          }}
          overlay={
            <>
              <ToolRail
                groups={[PAINT_TOOL_SPECS, SHAPE_TOOL_SPECS]}
                paintDisabledReason={paintDisabledReason}
              />
              {PAINT_TOOLS.has(tool) && <BrushOptions resolution={yaml.resolution} />}
              {crop && (
                <Notice>
                  {crop.rect
                    ? `Keep ${crop.rect.width} × ${crop.rect.height} px`
                    : 'Drag across the area to keep.'}
                  <Button size="sm" variant="outline" onClick={() => setCrop(null)}>
                    Cancel
                  </Button>
                  <Button size="sm" disabled={!crop.rect} onClick={applyCrop}>
                    Crop
                  </Button>
                </Notice>
              )}
              {conflict && (
                <Notice>
                  Someone saved this map since you opened it.
                  <Button size="sm" variant="outline" onClick={() => void saveAsNew()}>
                    Save as a new map
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setConflict(false);
                      void query.refetch();
                    }}
                  >
                    Reload
                  </Button>
                </Notice>
              )}
              {!crop && !conflict && problem && (
                <Notice>
                  <span>
                    <strong className="font-semibold text-status-error-ink">Can't save yet.</strong>{' '}
                    {problem.message}
                  </span>
                  {problem.at && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => problem.at && useEditor.getState().focusOn(problem.at)}
                    >
                      Show
                    </Button>
                  )}
                </Notice>
              )}
              {!crop && !conflict && !problem && tool && TOOL_HINT[tool] && (
                <Notice>{TOOL_HINT[tool]}</Notice>
              )}
            </>
          }
        />
      </div>
      {yamlOpen && <YamlDialog onClose={() => setYamlOpen(false)} />}
    </>
  );
}
