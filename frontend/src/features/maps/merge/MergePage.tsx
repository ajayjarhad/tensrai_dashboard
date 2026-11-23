import { Link, useNavigate } from '@tanstack/react-router';
import type { MapFeatures, MapYaml } from '@tensrai/shared';
import { dump } from 'js-yaml';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Crosshair,
  Eye,
  EyeOff,
  Lock,
  Merge,
  Plus,
  X,
} from 'lucide-react';
import { nanoid } from 'nanoid';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useDetailsDismiss } from '@/hooks/useDetailsDismiss';
import { errorMessageOf, gzipBase64, mapsApi } from '../api';
import { encodePgm, type Grid } from '../editor/grid';
import { ToolButton } from '../editor/ToolRail';
import { loadMapContent } from '../loadMap';
import { useMaps, useRefreshMaps } from '../queries';
import { alignTwoPoints, type Placement, type StagePoint } from './align';
import { readLocalMap } from './localFiles';
import { MergeCanvas, type MergeLayerState } from './MergeCanvas';
import { initialPlacement, mergedBounds, mergeFeatures } from './merge';
import type { MergeRequest, MergeResponse } from './merge.worker';
import MergeWorker from './merge.worker?worker';

// A Mongo document holds about 15 M cells of image beside everything else a map stores.
const MAX_CELLS = 15_000_000;

const runMerge = (request: MergeRequest) =>
  new Promise<{ grid: Grid; yaml: MapYaml }>((resolve, reject) => {
    const worker = new MergeWorker();
    worker.onmessage = (event: MessageEvent<MergeResponse>) => {
      worker.terminate();
      const { grid, yaml, error } = event.data;
      if (grid && yaml) resolve({ grid, yaml });
      else reject(new Error(error ?? 'The merge failed.'));
    };
    worker.onerror = event => {
      worker.terminate();
      reject(new Error(event.message || 'The merge failed.'));
    };
    worker.postMessage(request);
  });

type Source = { name: string; source: string; grid: Grid; yaml: MapYaml; features: MapFeatures };

const PROMPTS = [
  (moving: string) => `Click a feature on ${moving}, such as a corner.`,
  (_moving: string, reference: string) => `Now click the same feature on ${reference}.`,
  (moving: string) => `Click a second feature on ${moving}, far from the first.`,
  (_moving: string, reference: string) => `And the same one on ${reference}.`,
];

function AddMapMenu({ onAdd }: { onAdd: (source: Promise<Source>) => void }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const files = useRef<HTMLInputElement>(null);
  useDetailsDismiss(ref);
  const { data: maps = [] } = useMaps();
  const addStored = (mapId: string, name: string) =>
    onAdd(
      loadMapContent(mapId).then(({ detail, grid }) => ({
        name,
        source: 'Dashboard map',
        grid,
        yaml: detail.metadata,
        features: detail.features ?? {},
      }))
    );
  return (
    <details ref={ref} className="relative">
      <summary className="inline-flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md px-2.5 text-sm font-medium hover:bg-muted focus-ring-strong [&::-webkit-details-marker]:hidden">
        <Plus className="h-4 w-4" aria-hidden />
        Add map
      </summary>
      <div
        role="menu"
        className="absolute right-0 top-[calc(100%+6px)] z-30 grid max-h-80 min-w-[240px] gap-0.5 overflow-y-auto rounded-lg border border-border bg-popover p-1.5 shadow-md"
      >
        <button
          type="button"
          role="menuitem"
          onClick={() => files.current?.click()}
          className="rounded-md px-2.5 py-2 text-left text-sm font-medium hover:bg-muted focus-ring-strong"
        >
          From files (.pgm and .yaml)…
        </button>
        <div className="mx-1 my-0.5 h-px bg-border" />
        {maps.map(map => (
          <button
            key={map.id}
            type="button"
            role="menuitem"
            onClick={() => addStored(map.id, map.name)}
            className="rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted focus-ring-strong"
          >
            {map.name}
            <span className="block font-mono text-xs text-muted-foreground">{map.filename}</span>
          </button>
        ))}
      </div>
      <input
        ref={files}
        type="file"
        multiple
        accept=".pgm,.yaml,.yml,.json"
        aria-label="Map files"
        className="hidden"
        onChange={event => {
          const chosen = [...(event.target.files ?? [])];
          event.target.value = '';
          if (chosen.length) {
            onAdd(readLocalMap(chosen).then(local => ({ ...local, source: 'Uploaded file' })));
          }
        }}
      />
    </details>
  );
}

function LayerRow({
  layer,
  index,
  count,
  selected,
  onSelect,
  onChange,
  onMove,
  onRemove,
}: {
  layer: MergeLayerState;
  index: number;
  count: number;
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<MergeLayerState>) => void;
  onMove: (by: number) => void;
  onRemove: () => void;
}) {
  const reference = index === 0;
  return (
    <li
      className={`grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 rounded-lg py-1.5 pl-2 pr-1 ${selected ? 'bg-muted' : ''}`}
    >
      {reference ? (
        <Lock className="h-4 w-4 text-muted-foreground" aria-hidden />
      ) : (
        <span className="h-4 w-4" />
      )}
      <button type="button" onClick={onSelect} className="min-w-0 text-left focus-ring-strong">
        <span className="block truncate text-sm font-medium">{layer.name}</span>
        <span className="block text-xs text-muted-foreground">
          {reference
            ? 'Reference · keeps its coordinates'
            : `${layer.source}${index === count - 1 ? ' · on top' : ''}`}
        </span>
      </button>
      <span className="flex items-center">
        {!reference && (
          <>
            <ToolButton
              small
              label={`Move ${layer.name} up`}
              disabled={index === count - 1}
              onClick={() => onMove(1)}
            >
              <ChevronUp aria-hidden />
            </ToolButton>
            <ToolButton
              small
              label={`Move ${layer.name} down`}
              disabled={index === 1}
              onClick={() => onMove(-1)}
            >
              <ChevronDown aria-hidden />
            </ToolButton>
          </>
        )}
        <ToolButton
          small
          label={`${layer.visible ? 'Hide' : 'Show'} ${layer.name}`}
          onClick={() => onChange({ visible: !layer.visible })}
        >
          {layer.visible ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
        </ToolButton>
        {(!reference || count === 1) && (
          <ToolButton small label={`Remove ${layer.name}`} onClick={onRemove}>
            <X aria-hidden />
          </ToolButton>
        )}
      </span>
      {!reference && (
        <label className="col-start-2 col-end-4 flex items-center gap-2 text-xs text-muted-foreground">
          Opacity
          <input
            type="range"
            min={0.2}
            max={1}
            step={0.1}
            value={layer.opacity}
            onChange={event => onChange({ opacity: Number(event.target.value) })}
            className="flex-1 accent-ring-strong"
          />
          <span className="w-9 text-right font-mono tabular-nums">
            {Math.round(layer.opacity * 100)}%
          </span>
        </label>
      )}
    </li>
  );
}

function NameDialog({
  initial,
  busy,
  onSubmit,
  onClose,
}: {
  initial: string;
  busy: boolean;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) onSubmit(name.trim());
  };
  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-[440px]">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Merge into a new map</DialogTitle>
            <DialogDescription>
              Where maps overlap, the top layer wins. Tags, zones and paths move with their layer.
              The originals stay as they are.
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label="New map name"
            value={name}
            maxLength={100}
            autoFocus
            onChange={event => setName(event.target.value)}
            className="border-input-strong"
          />
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? 'Merging…' : 'Merge'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AlignStrip({
  moving,
  reference,
  pairs,
  resolution,
  onLineUp,
  onRestart,
}: {
  moving: MergeLayerState | undefined;
  reference: MergeLayerState | undefined;
  pairs: StagePoint[];
  resolution: number;
  onLineUp: () => void;
  onRestart: () => void;
}) {
  const [p1, q1, p2, q2] = pairs;
  const fit = p1 && q1 && p2 && q2 ? alignTwoPoints(p1, q1, p2, q2) : null;
  return (
    <fieldset
      aria-label="Line up by two points"
      className="absolute left-[78px] top-[17px] z-10 flex h-[52px] items-center gap-3 rounded-xl border border-border bg-card pl-3.5 pr-2 text-[13px] shadow-md"
    >
      {!moving || !reference ? (
        <span>Select the layer to move first.</span>
      ) : fit ? (
        <>
          {fit.residuals.map((residual, index) => (
            <span key={index === 0 ? 'A' : 'B'} className="tabular-nums">
              Pair {index === 0 ? 'A' : 'B'} · {(residual * resolution).toFixed(2)} m
            </span>
          ))}
          <Button size="sm" variant="outline" onClick={onRestart}>
            Start over
          </Button>
          <Button size="sm" onClick={onLineUp}>
            Line up
          </Button>
        </>
      ) : (
        <span>{PROMPTS[pairs.length]?.(moving.name, reference.name)}</span>
      )}
    </fieldset>
  );
}

const resultLabel = (layers: MergeLayerState[], resolution: number) => {
  const shown = layers.filter(layer => layer.visible);
  if (shown.length === 0) return 'Add the map whose coordinates to keep first';
  const { width, height } = mergedBounds(shown);
  return `Result ${width} × ${height} px · ${(width * resolution).toFixed(1)} × ${(height * resolution).toFixed(1)} m · the originals stay as they are`;
};

export function MergePage() {
  const navigate = useNavigate();
  const refreshMaps = useRefreshMaps();
  const [layers, setLayers] = useState<MergeLayerState[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [aligning, setAligning] = useState(false);
  const [pairs, setPairs] = useState<StagePoint[]>([]);
  const [naming, setNaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const reference = layers[0];
  const resolution = reference?.yaml.resolution ?? 0.05;
  const moving = layers.find(layer => layer.key === selectedKey && layer !== reference);

  const add = (source: Promise<Source>) => {
    source
      .then(loaded =>
        setLayers(current => {
          const key = nanoid(6);
          setSelectedKey(key);
          const base = current[0]?.yaml ?? loaded.yaml;
          return [
            ...current,
            {
              ...loaded,
              key,
              placement: initialPlacement(loaded.grid, loaded.yaml, base),
              opacity: current.length ? 0.6 : 1,
              visible: true,
            },
          ];
        })
      )
      .catch(error => toast.error(errorMessageOf(error, "Couldn't add that map.")));
  };
  const change = (key: string, patch: Partial<MergeLayerState>) =>
    setLayers(current =>
      current.map(layer => (layer.key === key ? { ...layer, ...patch } : layer))
    );
  const place = (key: string, placement: Placement) => change(key, { placement });
  const move = (index: number, by: number) =>
    setLayers(current => {
      const next = [...current];
      const [layer] = next.splice(index, 1);
      if (layer) next.splice(Math.max(1, index + by), 0, layer);
      return next;
    });

  // Arrow keys nudge the selected layer 5 cm.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[
        event.key
      ];
      const target = event.target as HTMLElement;
      if (!step || !moving || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      event.preventDefault();
      const units = 0.05 / resolution;
      place(moving.key, {
        ...moving.placement,
        x: moving.placement.x + (step[0] ?? 0) * units,
        y: moving.placement.y + (step[1] ?? 0) * units,
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const lineUp = () => {
    const [p1, q1, p2, q2] = pairs;
    if (!moving || !p1 || !q1 || !p2 || !q2) return;
    place(moving.key, alignTwoPoints(p1, q1, p2, q2).move(moving.placement));
    setPairs([]);
    setAligning(false);
  };

  const merge = async (name: string) => {
    const shown = layers.filter(layer => layer.visible);
    const { width, height } = mergedBounds(shown);
    if (width * height > MAX_CELLS) {
      toast.error(`The result would be ${width} × ${height} px, more than a map can hold.`);
      return;
    }
    setBusy(true);
    try {
      const { grid, yaml } = await runMerge({
        layers: shown.map(({ grid: layerGrid, yaml: layerYaml, placement }) => ({
          grid: layerGrid,
          yaml: layerYaml,
          placement,
        })),
        resolution,
      });
      await mapsApi.upload({
        name,
        yaml: dump(yaml, { flowLevel: 1 }),
        pgmGzipBase64: await gzipBase64(new Blob([encodePgm(grid)])),
        features: mergeFeatures(shown, resolution),
      });
      await refreshMaps();
      toast.success(`${name} is ready. It isn't on any robot yet.`);
      await navigate({ to: '/maps' });
    } catch (error) {
      toast.error(errorMessageOf(error, "Couldn't merge the maps."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card pl-2 pr-4">
        <Link
          to="/maps"
          aria-label="Back to Maps"
          title="Back to Maps"
          className="grid h-10 w-10 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-ring-strong"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <h1 className="text-base font-semibold">Merge maps</h1>
        <span className="truncate text-[13px] text-muted-foreground">
          {resultLabel(layers, resolution)}
        </span>
        <span className="flex-1" />
        <Button variant="ghost" asChild>
          <Link to="/maps">Cancel</Link>
        </Button>
        <Button
          disabled={layers.filter(layer => layer.visible).length < 2 || busy}
          title="Where maps overlap, the top layer wins. Tags, zones and paths move with their layer."
          onClick={() => setNaming(true)}
        >
          <Merge aria-hidden />
          Merge into new map
        </Button>
      </div>
      <MergeCanvas
        layers={layers}
        selectedKey={selectedKey}
        aligning={aligning}
        pairs={pairs}
        onSelect={setSelectedKey}
        onPlace={place}
        onAlignPoint={point =>
          setPairs(current => (current.length < 4 ? [...current, point] : current))
        }
        overlay={
          <>
            <div
              role="toolbar"
              aria-label="Tools"
              aria-orientation="vertical"
              className="absolute left-4 top-4 z-10 flex flex-col rounded-xl border border-border bg-card p-1.5 shadow-md"
            >
              <ToolButton
                label="Line up by two points (A)"
                title="Line up by two points: click the same feature on both maps, twice"
                pressed={aligning}
                disabled={layers.length < 2}
                onClick={() => {
                  setAligning(!aligning);
                  setPairs([]);
                }}
              >
                <Crosshair aria-hidden />
              </ToolButton>
            </div>
            {aligning && (
              <AlignStrip
                moving={moving}
                reference={reference}
                pairs={pairs}
                resolution={resolution}
                onLineUp={lineUp}
                onRestart={() => setPairs([])}
              />
            )}
            <div className="absolute right-4 top-4 z-10 w-[296px] rounded-xl border border-border bg-card p-2 shadow-md">
              <div className="flex items-center justify-between pb-2 pl-2 pr-0.5 pt-0.5">
                <span className="font-semibold">Layers</span>
                <AddMapMenu onAdd={add} />
              </div>
              {layers.length === 0 ? (
                <p className="px-2 pb-1 text-sm text-muted-foreground">
                  Add the map whose coordinates to keep first, then the maps to join to it.
                </p>
              ) : (
                <ul className="grid gap-0.5">
                  {[...layers].reverse().map(layer => {
                    const index = layers.indexOf(layer);
                    return (
                      <LayerRow
                        key={layer.key}
                        layer={layer}
                        index={index}
                        count={layers.length}
                        selected={layer.key === selectedKey}
                        onSelect={() => setSelectedKey(layer.key)}
                        onChange={patch => change(layer.key, patch)}
                        onMove={by => move(index, by)}
                        onRemove={() =>
                          setLayers(current => current.filter(item => item !== layer))
                        }
                      />
                    );
                  })}
                </ul>
              )}
              <p className="mx-2 mb-0.5 mt-2 text-xs text-muted-foreground">
                Drag a layer to move it, or its round handle to turn it. Arrow keys nudge 5 cm.
              </p>
            </div>
          </>
        }
      />
      {naming && reference && (
        <NameDialog
          initial={`${reference.name} merged`}
          busy={busy}
          onSubmit={name => void merge(name)}
          onClose={() => setNaming(false)}
        />
      )}
    </div>
  );
}
