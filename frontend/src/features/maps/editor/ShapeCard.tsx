import { PATH_TYPES, TAG_TYPES, ZONE_TYPES } from '@tensrai/shared';
import { ChevronDown, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useEditor } from './editorStore';
import {
  type FeatureKind,
  findFeature,
  missionsUsingTag,
  PATH_STYLE,
  removeFeature,
  TAG_LABEL,
  updateFeature,
  ZONE_STYLE,
} from './features';
import { ToolButton } from './ToolRail';

const changeSelected = (patch: Record<string, unknown>) => {
  const editor = useEditor.getState();
  const found = findFeature(editor.features, editor.selectedId);
  if (!found) return;
  const selected = editor.selectedId;
  editor.commit({
    kind: 'features',
    before: editor.features,
    after: updateFeature(editor.features, found.kind, found.id, patch),
  });
  editor.select(selected);
};

// A default name ("No-go zone 2") follows the type; a name someone chose stays.
const changeType = (kind: FeatureKind, type: string, name: string, next: string) => {
  const labelOf = (value: string) => TYPES[kind].find(([option]) => option === value)?.[1] ?? '';
  const old = labelOf(type);
  const renamed =
    kind !== 'tag' && old && name.startsWith(`${old} `)
      ? `${labelOf(next)}${name.slice(old.length)}`
      : name;
  changeSelected({ type: next, name: renamed });
};

// Returns why the selection can't be deleted, or deletes it.
export const deleteSelected = () => {
  const editor = useEditor.getState();
  const found = findFeature(editor.features, editor.selectedId);
  if (!found) return null;
  const users = found.kind === 'tag' ? missionsUsingTag(editor.features, found.id) : [];
  if (users.length > 0)
    return `Mission ${users.join(', ')} goes to this tag. Change the mission first.`;
  editor.commit({
    kind: 'features',
    before: editor.features,
    after: removeFeature(editor.features, found.kind, found.id),
  });
  return null;
};

const field =
  'h-9 w-full rounded-md border border-input-strong bg-background px-2.5 text-sm focus-ring-strong';

const TYPES = {
  zone: ZONE_TYPES.map(type => [type, ZONE_STYLE[type].label]),
  path: PATH_TYPES.map(type => [type, PATH_STYLE[type].label]),
  tag: TAG_TYPES.map(type => [type, TAG_LABEL[type]]),
} as const;

const swatchOf = (kind: 'zone' | 'path' | 'tag', type: string) =>
  kind === 'zone'
    ? ZONE_STYLE[type as keyof typeof ZONE_STYLE]?.color
    : kind === 'path'
      ? PATH_STYLE[type as keyof typeof PATH_STYLE]?.color
      : type === 'home'
        ? '#22c55e'
        : '#0f172a';

// Text fields commit when they lose focus, so typing a name is one undo step.
function CommitInput({
  label,
  value,
  type = 'text',
  onCommit,
}: {
  label: string;
  value: string;
  type?: 'text' | 'number';
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <input
      aria-label={label}
      type={type}
      step="any"
      value={draft}
      onChange={event => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={event => {
        if (event.key === 'Enter') commit();
      }}
      className={field}
    />
  );
}

function ParamsEditor({ params }: { params: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<[string, string][]>(() => Object.entries(params));
  const save = (next: [string, string][]) => {
    const record = Object.fromEntries(
      next.filter(([key]) => key.trim()).map(([key, value]) => [key.trim(), value])
    );
    if (JSON.stringify(record) !== JSON.stringify(params)) changeSelected({ params: record });
  };
  const edit = (index: number, at: 0 | 1, text: string) =>
    setRows(current =>
      current.map((row, i) => (i === index ? (at === 0 ? [text, row[1]] : [row[0], text]) : row))
    );
  return (
    <div className="grid gap-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-8 items-center justify-between rounded-md px-1.5 text-sm hover:bg-muted focus-ring-strong"
      >
        Robot parameters
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          {Object.keys(params).length}
          <ChevronDown className={open ? 'h-4 w-4 rotate-180' : 'h-4 w-4'} aria-hidden />
        </span>
      </button>
      {open && (
        <div className="grid gap-1.5">
          {rows.map(([key, value], index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place by position.
            <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
              <input
                aria-label="Parameter name"
                value={key}
                onChange={event => edit(index, 0, event.target.value)}
                onBlur={() => save(rows)}
                className={field}
              />
              <input
                aria-label="Parameter value"
                value={value}
                onChange={event => edit(index, 1, event.target.value)}
                onBlur={() => save(rows)}
                className={field}
              />
              <ToolButton
                small
                label="Remove parameter"
                onClick={() => {
                  const next = rows.filter((_, i) => i !== index);
                  setRows(next);
                  save(next);
                }}
              >
                <X aria-hidden />
              </ToolButton>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setRows([...rows, ['', '']])}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-1.5 text-sm text-link hover:bg-muted focus-ring-strong"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add parameter
          </button>
        </div>
      )}
    </div>
  );
}

// The selected zone, path or tag: its type, name and what a robot reads from it.
export function ShapeCard({ position }: { position: { left: number; top: number } }) {
  const features = useEditor(state => state.features);
  const selectedId = useEditor(state => state.selectedId);
  const [refusal, setRefusal] = useState<string | null>(null);
  const found = findFeature(features, selectedId);
  if (!found) return null;
  const { kind, item } = found;
  const type = String(item['type'] ?? 'mission');
  const name = String(item['name'] ?? '');
  const users = kind === 'tag' ? missionsUsingTag(features, found.id) : [];
  const note =
    refusal ?? (users.length > 0 ? `Mission ${users.join(', ')} goes to this tag.` : null);
  return (
    <section
      key={selectedId}
      aria-label={`Selected ${kind}: ${name}`}
      style={position}
      className="absolute z-10 grid w-[272px] gap-3 rounded-xl border border-border bg-card p-3 shadow-md"
    >
      <div className="flex items-center gap-2 font-semibold">
        <span
          aria-hidden
          className="h-3.5 w-3.5 shrink-0 rounded border-2"
          style={{ borderColor: swatchOf(kind, type) }}
        />
        <select
          aria-label={`${kind[0]?.toUpperCase()}${kind.slice(1)} type`}
          value={type}
          onChange={event => changeType(kind, type, name, event.target.value)}
          className="h-8 flex-1 rounded-md bg-transparent px-1 font-semibold focus-ring-strong"
        >
          {TYPES[kind].map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <ToolButton
          small
          label={`Delete ${kind}`}
          title={users.length ? `Used by mission ${users.join(', ')}` : 'Delete (Del)'}
          onClick={() => setRefusal(deleteSelected())}
        >
          <Trash2 aria-hidden />
        </ToolButton>
      </div>
      <CommitInput
        key={`name:${name}`}
        label={`${kind} name`}
        value={name}
        onCommit={value => changeSelected({ name: value.slice(0, 100) })}
      />
      {kind === 'path' && (
        <label className="grid gap-1 text-xs text-muted-foreground">
          Width (m)
          <CommitInput
            key={`width:${String(item['width'])}`}
            label="Width in metres"
            type="number"
            value={String(item['width'] ?? '')}
            onCommit={value => {
              const width = Number(value);
              if (width > 0 && width <= 10) changeSelected({ width });
            }}
          />
        </label>
      )}
      {kind === 'tag' && (
        <label className="grid gap-1 text-xs text-muted-foreground">
          Facing (degrees, counter-clockwise from east)
          <CommitInput
            key={`theta:${String(item['theta'])}`}
            label="Facing in degrees"
            type="number"
            value={String(Math.round(((Number(item['theta'] ?? 0) * 180) / Math.PI) * 10) / 10)}
            onCommit={value => {
              const degrees = Number(value);
              if (Number.isFinite(degrees))
                changeSelected({ theta: Math.round(((degrees * Math.PI) / 180) * 1000) / 1000 });
            }}
          />
        </label>
      )}
      {kind === 'zone' && (
        <ParamsEditor
          key={JSON.stringify(item['params'] ?? {})}
          params={(item['params'] as Record<string, string>) ?? {}}
        />
      )}
      {note && <p className="text-xs text-status-warning-ink">{note}</p>}
    </section>
  );
}
