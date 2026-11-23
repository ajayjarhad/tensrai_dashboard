import type Konva from 'konva';
import { Layers, Minus, Plus, Scan } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useZoom } from '@/features/robot-map/hooks/useZoom';
import { useElementSize } from '@/hooks/useElementSize';
import { Circle, Image as KonvaImage, Layer, Rect, Stage } from '@/lib/map/konva';
import { mapPixelToWorld } from '@/lib/map/mapTransforms';
import { gestureMode, useEditor } from './editorStore';
import { FeaturesLayer } from './FeaturesLayer';
import { boundsInCells, cellTransforms, findFeature, toCell, zoneAt } from './features';
import {
  boundsOfCells,
  clampRect,
  type Rect as GridRect,
  type Point,
  paintCells,
  paintValues,
  strokeCells,
  toPixelEdit,
  writeRgba,
} from './grid';
import { finishOnDoubleClick, placeDown, placeMove, placeUp } from './placement';
import { ShapeCard } from './ShapeCard';

const MIN_SCALE = 0.05;
const MAX_SCALE = 40;

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

// Space held: pan with any tool, as in most drawing apps.
function useSpaceHeld() {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || isTyping(event.target)) return;
      event.preventDefault();
      setHeld(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') setHeld(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);
  return held;
}

interface Stroke {
  touched: Map<number, number>;
  value: number;
  last: Point;
}

export interface CropState {
  active: boolean;
  rect: GridRect | null;
  onChange: (rect: GridRect | null) => void;
}

type View = { scale: number; offset: { x: number; y: number }; width: number; height: number };

// Beside the selected shape, on its right unless that runs off the canvas, clear of the tool rail.
const placeCard = (
  found: ReturnType<typeof findFeature>,
  transforms: ReturnType<typeof cellTransforms> | null,
  { scale, offset, width: canvasWidth, height }: View
) => {
  if (!found || !transforms) return null;
  const box = boundsInCells(found, transforms);
  const [width, gap, rail] = [272, 16, 88];
  const right = box.right * scale + offset.x + gap;
  const left = box.left * scale + offset.x - gap - width;
  const x = right + width <= canvasWidth - gap ? right : Math.max(rail, left);
  const y = Math.min(Math.max(gap, box.top * scale + offset.y), Math.max(gap, height - 320));
  return { left: x, top: y };
};

function Readout({
  world,
  zone,
}: {
  world: { x: number; y: number } | null;
  zone?: string | undefined;
}) {
  return (
    <div className="pointer-events-none absolute bottom-4 left-4 rounded-lg border border-border bg-card px-3 py-1.5 font-mono text-xs tabular-nums shadow-sm">
      {world ? `x ${world.x.toFixed(2)} m · y ${world.y.toFixed(2)} m` : 'x — · y —'}
      {zone ? ` · in ${zone}` : ''}
    </div>
  );
}

function ViewControls({
  scale,
  featuresHidden,
  onToggleFeatures,
  onZoom,
  onFit,
}: {
  scale: number;
  featuresHidden: boolean;
  onToggleFeatures: () => void;
  onZoom: (factor: number) => void;
  onFit: () => void;
}) {
  return (
    <div className="absolute bottom-4 right-4 flex items-center gap-0.5 rounded-lg border border-border bg-card p-1 shadow-sm">
      <HudButton
        label={featuresHidden ? 'Show zones, paths and tags' : 'Hide zones, paths and tags'}
        pressed={!featuresHidden}
        onClick={onToggleFeatures}
      >
        <Layers className="h-4 w-4" />
      </HudButton>
      <span className="mx-1 h-5 w-px bg-border" />
      <HudButton label="Zoom out (−)" onClick={() => onZoom(1 / 1.25)}>
        <Minus className="h-4 w-4" />
      </HudButton>
      <span className="min-w-12 text-center font-mono text-xs tabular-nums">
        {Math.round(scale * 100)}%
      </span>
      <HudButton label="Zoom in (+)" onClick={() => onZoom(1.25)}>
        <Plus className="h-4 w-4" />
      </HudButton>
      <HudButton label="Fit map (0)" onClick={onFit}>
        <Scan className="h-4 w-4" />
      </HudButton>
    </div>
  );
}

const CURSOR = { pan: 'grab', paint: 'none', place: 'crosshair', crop: 'crosshair' } as const;

// The pointer in world metres, and the zone it is over.
const readoutAt = (
  pointer: Point | null,
  grid: ReturnType<typeof useEditor.getState>['grid'],
  yaml: ReturnType<typeof useEditor.getState>['yaml'],
  features: ReturnType<typeof useEditor.getState>['features'] | null
) => {
  if (!pointer || !grid || !yaml) return { world: null, zone: undefined };
  const world = mapPixelToWorld(pointer, cellTransforms(grid, yaml));
  return { world, zone: features ? zoneAt(features, [world.x, world.y])?.name : undefined };
};

// The crop box and the brush outline, above everything and never in the way of a click.
function GuideLayer({
  cropRect,
  brush,
  brushSize,
  erasing,
}: {
  cropRect: GridRect | null;
  brush: Point | null;
  brushSize: number;
  erasing: boolean;
}) {
  return (
    <Layer listening={false}>
      {cropRect && (
        <Rect
          {...cropRect}
          stroke="#2085E9"
          strokeWidth={2}
          dash={[6, 4]}
          strokeScaleEnabled={false}
          fill="rgba(32, 133, 233, 0.12)"
          perfectDrawEnabled={false}
        />
      )}
      {brush && (
        <Circle
          x={brush.x}
          y={brush.y}
          radius={Math.max(brushSize / 2, 0.5)}
          stroke={erasing ? '#2085E9' : '#111'}
          strokeWidth={1.5}
          strokeScaleEnabled={false}
        />
      )}
    </Layer>
  );
}

// `overlay` is the HTML floating above the canvas: the tool rail, options, notices and cards.
export function EditorCanvas({ crop, overlay }: { crop: CropState; overlay?: ReactNode }) {
  const { ref, size } = useElementSize();
  const stageRef = useRef<Konva.Stage>(null);
  const imageRef = useRef<Konva.Image>(null);
  const grid = useEditor(state => state.grid);
  const yaml = useEditor(state => state.yaml);
  const gridVersion = useEditor(state => state.gridVersion);
  const viewShift = useEditor(state => state.viewShift);
  const focus = useEditor(state => state.focus);
  const select = useEditor(state => state.select);
  const features = useEditor(state => state.features);
  const selectedId = useEditor(state => state.selectedId);
  const featuresHidden = useEditor(state => state.featuresHidden);
  const toggleFeatures = useEditor(state => state.toggleFeatures);
  const tool = useEditor(state => state.tool);
  const brushSize = useEditor(state => state.brushSize);
  const commit = useEditor(state => state.commit);
  const spaceHeld = useSpaceHeld();
  const [scale, setScale] = useState(1);
  // Where the map sits on screen, kept in step so the shape card can sit beside its shape.
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [pointer, setPointer] = useState<Point | null>(null);
  const stroke = useRef<Stroke | null>(null);
  const lineStart = useRef<Point | null>(null);
  const cropStart = useRef<Point | null>(null);
  const fitted = useRef(false);
  const canvas = useMemo(() => document.createElement('canvas'), []);
  const negate = yaml?.negate ? 1 : 0;
  const mode = crop.active ? 'crop' : gestureMode(tool, spaceHeld);

  // The whole image, after a load, a crop, an undo or a redo.
  // biome-ignore lint/correctness/useExhaustiveDependencies: gridVersion marks in-place changes to the grid.
  useEffect(() => {
    if (!grid) return;
    canvas.width = grid.width;
    canvas.height = grid.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    const image = context.createImageData(grid.width, grid.height);
    writeRgba(grid, negate, image, { x: 0, y: 0, width: grid.width, height: grid.height });
    context.putImageData(image, 0, 0);
    imageRef.current?.getLayer()?.batchDraw();
  }, [canvas, grid, gridVersion, negate]);

  const track = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    setScale(stage.scaleX());
    setOffset(stage.position());
  }, []);

  // A crop draws the kept area from the top-left corner; move the view so it stays put on screen.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || viewShift.count === 0) return;
    const scaleNow = stage.scaleX();
    stage.position({
      x: stage.x() + viewShift.x * scaleNow,
      y: stage.y() + viewShift.y * scaleNow,
    });
    stage.batchDraw();
    track();
  }, [viewShift, track]);

  // "Show" on a problem: centre the view on that place.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new focus request moves the view.
  useEffect(() => {
    const stage = stageRef.current;
    const editor = useEditor.getState();
    if (!stage || focus.count === 0 || !editor.grid || !editor.yaml) return;
    const cell = toCell([focus.x, focus.y], cellTransforms(editor.grid, editor.yaml));
    const scaleNow = stage.scaleX();
    stage.position({
      x: size.width / 2 - cell.x * scaleNow,
      y: size.height / 2 - cell.y * scaleNow,
    });
    stage.batchDraw();
    track();
  }, [focus]);

  const redrawCells = (cells: Set<number>) => {
    const area = grid && boundsOfCells(grid, cells);
    const context = canvas.getContext('2d');
    if (!grid || !area || !context) return;
    const image = context.createImageData(area.width, area.height);
    writeRgba(grid, negate, image, area);
    context.putImageData(image, area.x, area.y);
    imageRef.current?.getLayer()?.batchDraw();
  };

  const zoomTo = useCallback(
    (next: number, around: Point) => {
      const stage = stageRef.current;
      if (!stage) return;
      const old = stage.scaleX();
      const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, next));
      stage.scale({ x: clamped, y: clamped });
      stage.position({
        x: around.x - (around.x - stage.x()) * (clamped / old),
        y: around.y - (around.y - stage.y()) * (clamped / old),
      });
      stage.batchDraw();
      track();
    },
    [track]
  );

  const fit = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || !grid || !size.width || !size.height) return;
    const next = Math.min(size.width / grid.width, size.height / grid.height) * 0.92;
    stage.scale({ x: next, y: next });
    stage.position({
      x: (size.width - grid.width * next) / 2,
      y: (size.height - grid.height * next) / 2,
    });
    stage.batchDraw();
    track();
  }, [grid, size.width, size.height, track]);

  useEffect(() => {
    if (fitted.current || !grid || !size.width) return;
    fit();
    fitted.current = true;
  }, [fit, grid, size.width]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey) return;
      const center = { x: size.width / 2, y: size.height / 2 };
      if (event.key === '0') fit();
      else if (event.key === '+' || event.key === '=') zoomTo(scale * 1.25, center);
      else if (event.key === '-') zoomTo(scale / 1.25, center);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fit, zoomTo, scale, size.width, size.height]);

  const onWheel = useZoom({
    enableZooming: true,
    minScale: MIN_SCALE,
    maxScale: MAX_SCALE,
    onZoom: track,
  });

  const cellAt = () => stageRef.current?.getRelativePointerPosition() ?? null;
  // A few screen pixels, in cells, for closing a zone on its first point and for double-clicks.
  const tolerance = 8 / scale;

  const endStroke = () => {
    const current = stroke.current;
    stroke.current = null;
    if (!current || current.touched.size === 0) return;
    lineStart.current = current.last;
    commit({ kind: 'pixels', edit: toPixelEdit(current.touched, current.value) });
  };

  const paintTo = (at: Point) => {
    const current = stroke.current;
    if (!grid || !current) return;
    const cells = strokeCells(grid, current.last, at, brushSize);
    paintCells(grid, cells, current.value, current.touched);
    redrawCells(cells);
    current.last = at;
  };

  const onPointerDown = (event: Konva.KonvaEventObject<PointerEvent>) => {
    const at = cellAt();
    if (!at || !grid) return;
    if (mode === 'crop') {
      cropStart.current = at;
      crop.onChange(null);
      return;
    }
    const gesture = gestureMode(tool, spaceHeld, event.evt.button);
    if (gesture === 'place') {
      placeDown(at, tolerance);
      return;
    }
    if (gesture !== 'paint') return;
    const values = paintValues(negate, grid.maxVal);
    // Shift-click: a straight line from where the last stroke ended.
    const from = event.evt.shiftKey && lineStart.current ? lineStart.current : at;
    stroke.current = {
      touched: new Map(),
      value: tool === 'draw' ? values.occupied : values.free,
      last: from,
    };
    paintTo(at);
    window.addEventListener('pointerup', endStroke, { once: true });
  };

  const onPointerMove = () => {
    const at = cellAt();
    setPointer(at);
    if (!at) return;
    if (cropStart.current && grid) {
      const start = cropStart.current;
      crop.onChange(
        clampRect(grid, { x: start.x, y: start.y, width: at.x - start.x, height: at.y - start.y })
      );
      return;
    }
    if (stroke.current) paintTo(at);
    else if (mode === 'place') placeMove(at);
  };

  const onPointerUp = () => {
    cropStart.current = null;
    const at = cellAt();
    if (mode === 'place' && at) placeUp(at, tolerance);
  };

  // A click on empty map, with no tool, clears the selection.
  const onStageClick = (event: Konva.KonvaEventObject<MouseEvent>) => {
    if (mode === 'pan' && event.target === event.target.getStage()) select(null);
  };

  // Panning moves the card with its shape; with nothing selected there is nothing to follow.
  const trackWhileCardShows = (event: Konva.KonvaEventObject<DragEvent>) => {
    if (selectedId && event.target === event.target.getStage()) track();
  };
  const { world, zone: hoveredZone } = readoutAt(
    pointer,
    grid,
    yaml,
    featuresHidden ? null : features
  );
  const cursor = CURSOR[mode];
  const card = placeCard(
    featuresHidden ? null : findFeature(features, selectedId),
    grid && yaml ? cellTransforms(grid, yaml) : null,
    { scale, offset, width: size.width, height: size.height }
  );

  return (
    <section
      ref={ref}
      aria-label="Map canvas"
      className="relative min-h-0 flex-1 overflow-hidden bg-[#cdcdcd]"
      style={{ cursor }}
    >
      {size.width > 0 && (
        <Stage
          ref={stageRef}
          width={size.width}
          height={size.height}
          draggable={mode === 'pan'}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onClick={onStageClick}
          onDragMove={trackWhileCardShows}
          onDragEnd={track}
          onDblClick={() => mode === 'place' && finishOnDoubleClick(tolerance)}
          onPointerLeave={() => setPointer(null)}
        >
          <Layer imageSmoothingEnabled={false} listening={false}>
            {grid && <KonvaImage ref={imageRef} image={canvas} />}
          </Layer>
          {!featuresHidden && <FeaturesLayer scale={scale} />}
          <GuideLayer
            cropRect={crop.active ? crop.rect : null}
            brush={mode === 'paint' ? pointer : null}
            brushSize={brushSize}
            erasing={tool === 'eraser'}
          />
        </Stage>
      )}
      {overlay}
      {card && <ShapeCard position={card} />}
      <Readout world={world} zone={hoveredZone} />
      <ViewControls
        scale={scale}
        featuresHidden={featuresHidden}
        onToggleFeatures={toggleFeatures}
        onZoom={factor => zoomTo(scale * factor, { x: size.width / 2, y: size.height / 2 })}
        onFit={fit}
      />
    </section>
  );
}

function HudButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={onClick}
      className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-ring-strong"
    >
      {children}
    </button>
  );
}
