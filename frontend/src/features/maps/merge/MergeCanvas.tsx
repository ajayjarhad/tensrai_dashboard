import type { MapFeatures, MapYaml } from '@tensrai/shared';
import type Konva from 'konva';
import { Minus, Plus, Scan } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useZoom } from '@/features/robot-map/hooks/useZoom';
import { useElementSize } from '@/hooks/useElementSize';
import { Circle, Image as KonvaImage, Layer, Line, Stage, Text } from '@/lib/map/konva';
import { type Grid, writeRgba } from '../editor/grid';
import { type Placement, type StagePoint, toStage, turnAbout } from './align';

export interface MergeLayerState {
  key: string;
  name: string;
  source: string;
  grid: Grid;
  yaml: MapYaml;
  features: MapFeatures;
  placement: Placement;
  opacity: number;
  visible: boolean;
}

const MIN_SCALE = 0.02;
const MAX_SCALE = 20;
const PAIR_COLORS = ['#2085e9', '#16a34a'] as const;

// One canvas per layer image, painted once.
const canvases = new WeakMap<Grid, HTMLCanvasElement>();
const canvasOf = (grid: Grid, negate: number | undefined) => {
  const cached = canvases.get(grid);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = grid.width;
  canvas.height = grid.height;
  const context = canvas.getContext('2d');
  if (context) {
    const image = context.createImageData(grid.width, grid.height);
    writeRgba(grid, negate, image, { x: 0, y: 0, width: grid.width, height: grid.height });
    context.putImageData(image, 0, 0);
  }
  canvases.set(grid, canvas);
  return canvas;
};

const centreOf = ({ grid, placement }: MergeLayerState) =>
  toStage(placement, grid.width / 2, grid.height / 2);

function TurnHandle({
  layer,
  scale,
  onPlace,
}: {
  layer: MergeLayerState;
  scale: number;
  onPlace: (placement: Placement) => void;
}) {
  const centre = centreOf(layer);
  // 28 screen pixels above the layer's top edge, in its own pixels.
  const lift = 28 / (scale * layer.placement.scale);
  const handle = toStage(layer.placement, layer.grid.width / 2, -lift);
  return (
    <>
      <Line
        points={[centre.x, centre.y, handle.x, handle.y]}
        stroke="#2085e9"
        strokeWidth={1.5}
        dash={[4, 4]}
        strokeScaleEnabled={false}
        listening={false}
      />
      <Circle
        x={handle.x}
        y={handle.y}
        radius={7 / scale}
        fill="#ffffff"
        stroke="#2085e9"
        strokeWidth={2}
        strokeScaleEnabled={false}
        perfectDrawEnabled={false}
        draggable
        onDragMove={(event: Konva.KonvaEventObject<DragEvent>) => {
          const at = { x: event.target.x(), y: event.target.y() };
          // The handle points along the layer's -y, which is its turn minus 90° on screen.
          const angle = (Math.atan2(at.y - centre.y, at.x - centre.x) * 180) / Math.PI + 90;
          onPlace(turnAbout(layer.placement, centre, angle - layer.placement.rotation));
        }}
      />
    </>
  );
}

function PairMarkers({ pairs, scale }: { pairs: StagePoint[]; scale: number }) {
  return (
    <>
      {pairs.map((point, index) => (
        <Circle
          key={`${point.x}:${point.y}`}
          x={point.x}
          y={point.y}
          radius={6 / scale}
          stroke={PAIR_COLORS[index % 2]}
          strokeWidth={3}
          strokeScaleEnabled={false}
          listening={false}
        />
      ))}
      {pairs.map((point, index) => (
        <Text
          key={`label:${point.x}:${point.y}`}
          x={point.x + 8 / scale}
          y={point.y - 16 / scale}
          text={`${index < 2 ? 'A' : 'B'}${(index % 2) + 1}`}
          fontSize={12 / scale}
          fontStyle="bold"
          fill={PAIR_COLORS[index % 2]}
          listening={false}
        />
      ))}
    </>
  );
}

// Where the selected layer's own origin lands in the reference map, and how far it is turned.
export const layerPose = (layer: MergeLayerState, resolution: number) => {
  const origin = toStage(layer.placement, 0, layer.grid.height);
  const turn = ((((-layer.placement.rotation + 180) % 360) + 360) % 360) - 180;
  return { x: origin.x * resolution, y: -origin.y * resolution, degrees: turn };
};

function PoseReadout({ layer, resolution }: { layer: MergeLayerState; resolution: number }) {
  const pose = layerPose(layer, resolution);
  const signed = (value: number, digits: number) =>
    `${value < 0 ? '−' : ''}${Math.abs(value).toFixed(digits)}`;
  return (
    <div className="pointer-events-none absolute bottom-4 left-4 rounded-lg border border-border bg-card px-3 py-1.5 font-mono text-xs tabular-nums shadow-sm">
      {layer.name} · x {signed(pose.x, 2)} m · y {signed(pose.y, 2)} m · {signed(pose.degrees, 1)}°
    </div>
  );
}

export function MergeCanvas({
  layers,
  selectedKey,
  aligning,
  pairs,
  onSelect,
  onPlace,
  onAlignPoint,
  overlay,
}: {
  layers: MergeLayerState[];
  selectedKey: string | null;
  aligning: boolean;
  pairs: StagePoint[];
  onSelect: (key: string) => void;
  onPlace: (key: string, placement: Placement) => void;
  onAlignPoint: (point: StagePoint) => void;
  overlay: ReactNode;
}) {
  const { ref, size } = useElementSize();
  const stageRef = useRef<Konva.Stage>(null);
  const [scale, setScale] = useState(1);
  const fittedCount = useRef(0);

  const fit = useCallback(() => {
    const stage = stageRef.current;
    const shown = layers.filter(layer => layer.visible);
    if (!stage || shown.length === 0 || !size.width) return;
    const corners = shown.flatMap(({ grid, placement }) =>
      [
        [0, 0],
        [grid.width, 0],
        [0, grid.height],
        [grid.width, grid.height],
      ].map(([u, v]) => toStage(placement, u ?? 0, v ?? 0))
    );
    const left = Math.min(...corners.map(point => point.x));
    const top = Math.min(...corners.map(point => point.y));
    const width = Math.max(...corners.map(point => point.x)) - left;
    const height = Math.max(...corners.map(point => point.y)) - top;
    const next = Math.min(size.width / width, size.height / height) * 0.85;
    stage.scale({ x: next, y: next });
    stage.position({
      x: (size.width - width * next) / 2 - left * next,
      y: (size.height - height * next) / 2 - top * next,
    });
    stage.batchDraw();
    setScale(next);
  }, [layers, size.width, size.height]);

  // Fit when a layer is added, not when one moves.
  useEffect(() => {
    if (layers.length === fittedCount.current || !size.width) return;
    fittedCount.current = layers.length;
    fit();
  }, [fit, layers.length, size.width]);

  const zoomBy = (factor: number) => {
    const stage = stageRef.current;
    if (!stage) return;
    const old = stage.scaleX();
    const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, old * factor));
    const centre = { x: size.width / 2, y: size.height / 2 };
    stage.scale({ x: next, y: next });
    stage.position({
      x: centre.x - (centre.x - stage.x()) * (next / old),
      y: centre.y - (centre.y - stage.y()) * (next / old),
    });
    stage.batchDraw();
    setScale(next);
  };

  const onWheel = useZoom({
    enableZooming: true,
    minScale: MIN_SCALE,
    maxScale: MAX_SCALE,
    onZoom: setScale,
  });
  const selected = layers.find(layer => layer.key === selectedKey);
  const reference = layers[0];

  return (
    <section
      ref={ref}
      aria-label="Merge canvas"
      className="relative min-h-0 flex-1 overflow-hidden bg-[#cdcdcd]"
      style={{ cursor: aligning ? 'crosshair' : 'grab' }}
    >
      {size.width > 0 && (
        <Stage
          ref={stageRef}
          width={size.width}
          height={size.height}
          draggable={!aligning}
          onWheel={onWheel}
          onClick={() => {
            const point = stageRef.current?.getRelativePointerPosition();
            if (aligning && point) onAlignPoint(point);
          }}
        >
          <Layer imageSmoothingEnabled={false}>
            {layers
              .filter(layer => layer.visible)
              .map(layer => (
                <KonvaImage
                  key={layer.key}
                  image={canvasOf(layer.grid, layer.yaml.negate ? 1 : 0)}
                  x={layer.placement.x}
                  y={layer.placement.y}
                  rotation={layer.placement.rotation}
                  scaleX={layer.placement.scale}
                  scaleY={layer.placement.scale}
                  opacity={layer.opacity}
                  listening={!aligning}
                  draggable={!aligning && layer !== reference}
                  onMouseDown={() => onSelect(layer.key)}
                  onDragMove={(event: Konva.KonvaEventObject<DragEvent>) =>
                    onPlace(layer.key, {
                      ...layer.placement,
                      x: event.target.x(),
                      y: event.target.y(),
                    })
                  }
                />
              ))}
          </Layer>
          <Layer>
            {selected && selected !== reference && !aligning && selected.visible && (
              <TurnHandle
                layer={selected}
                scale={scale}
                onPlace={placement => onPlace(selected.key, placement)}
              />
            )}
            <PairMarkers pairs={pairs} scale={scale} />
          </Layer>
        </Stage>
      )}
      {overlay}
      {selected && reference && (
        <PoseReadout layer={selected} resolution={reference.yaml.resolution} />
      )}
      <div className="absolute bottom-4 right-4 flex items-center gap-0.5 rounded-lg border border-border bg-card p-1 shadow-sm">
        {[
          {
            label: 'Zoom out (−)',
            icon: <Minus className="h-4 w-4" />,
            run: () => zoomBy(1 / 1.25),
          },
          { label: 'Zoom in (+)', icon: <Plus className="h-4 w-4" />, run: () => zoomBy(1.25) },
          { label: 'Fit maps (0)', icon: <Scan className="h-4 w-4" />, run: fit },
        ].map(({ label, icon, run }) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            title={label}
            onClick={run}
            className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-ring-strong"
          >
            {icon}
          </button>
        ))}
      </div>
    </section>
  );
}
