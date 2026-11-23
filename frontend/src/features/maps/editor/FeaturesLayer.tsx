import type { LocationTag, MapFeatures, MapPath, MapZone } from '@tensrai/shared';
import type Konva from 'konva';
import { useRef } from 'react';
import { Circle, Group, Layer, Line, Text } from '@/lib/map/konva';
import { headingToRotation } from '@/lib/map/mapTransforms';
import { useEditor } from './editorStore';
import {
  cellTransforms,
  type FeatureKind,
  headingBetween,
  PATH_STYLE,
  parseSelection,
  selectionKey,
  toCell,
  toWorld,
  updateFeature,
  ZONE_STYLE,
} from './features';
import type { Point } from './grid';

type Transforms = ReturnType<typeof cellTransforms>;
const DRAFT_COLOR = '#2085e9';

const flat = (points: readonly (readonly [number, number])[], transforms: Transforms) =>
  points.flatMap(point => {
    const cell = toCell(point, transforms);
    return [cell.x, cell.y];
  });

// Handle drags preview live and commit once, so a drag is one undo step.
function useDragCommit() {
  const before = useRef<MapFeatures | null>(null);
  return {
    start: () => {
      before.current = useEditor.getState().features;
    },
    end: () => {
      const editor = useEditor.getState();
      if (before.current && before.current !== editor.features) {
        const selected = editor.selectedId;
        editor.commit({ kind: 'features', before: before.current, after: editor.features });
        editor.select(selected);
      }
      before.current = null;
    },
  };
}

function VertexHandles({
  kind,
  id,
  points,
  field,
  transforms,
  scale,
  color,
}: {
  kind: FeatureKind;
  id: string;
  points: [number, number][];
  field: 'polygon' | 'points';
  transforms: Transforms;
  scale: number;
  color: string;
}) {
  const drag = useDragCommit();
  return (
    <>
      {points.map((point, index) => {
        const cell = toCell(point, transforms);
        return (
          <Circle
            // biome-ignore lint/suspicious/noArrayIndexKey: a vertex is its position in the shape.
            key={index}
            x={cell.x}
            y={cell.y}
            radius={5 / scale}
            fill="#ffffff"
            stroke={color}
            strokeWidth={2}
            strokeScaleEnabled={false}
            perfectDrawEnabled={false}
            draggable
            onDragStart={drag.start}
            onDragMove={(event: Konva.KonvaEventObject<DragEvent>) => {
              const moved = points.map((current, at) =>
                at === index
                  ? toWorld({ x: event.target.x(), y: event.target.y() }, transforms)
                  : current
              );
              const editor = useEditor.getState();
              editor.previewFeatures(updateFeature(editor.features, kind, id, { [field]: moved }));
            }}
            onDragEnd={drag.end}
          />
        );
      })}
    </>
  );
}

function TagMarker({
  tag,
  transforms,
  scale,
  selected,
  interactive,
}: {
  tag: LocationTag;
  transforms: Transforms;
  scale: number;
  selected: boolean;
  interactive: boolean;
}) {
  const select = useEditor(state => state.select);
  const drag = useDragCommit();
  const key = selectionKey('tag', tag.id);
  const cell = toCell([tag.x, tag.y], transforms);
  const yaw = transforms.origin[2];
  const rotation = headingToRotation(tag.theta ?? 0, yaw);
  const reach = 18 / scale;
  const tip = {
    x: cell.x + reach * Math.cos((rotation * Math.PI) / 180),
    y: cell.y + reach * Math.sin((rotation * Math.PI) / 180),
  };
  const preview = (patch: Record<string, unknown>) => {
    const editor = useEditor.getState();
    editor.previewFeatures(updateFeature(editor.features, 'tag', String(tag.id), patch));
  };
  return (
    <>
      <Group
        x={cell.x}
        y={cell.y}
        rotation={rotation}
        listening={interactive}
        draggable={interactive && selected}
        onClick={() => select(key)}
        onTap={() => select(key)}
        onDragStart={drag.start}
        onDragMove={(event: Konva.KonvaEventObject<DragEvent>) => {
          const [x, y] = toWorld({ x: event.target.x(), y: event.target.y() }, transforms);
          preview({ x, y });
        }}
        onDragEnd={drag.end}
      >
        <Line
          points={[0, 0, reach, 0]}
          stroke="#0f172a"
          strokeWidth={2}
          strokeScaleEnabled={false}
        />
        <Circle
          radius={7 / scale}
          fill={tag.type === 'home' ? '#22c55e' : '#ffffff'}
          stroke={selected ? DRAFT_COLOR : '#0f172a'}
          strokeWidth={selected ? 3 : 2}
          strokeScaleEnabled={false}
          perfectDrawEnabled={false}
        />
      </Group>
      <Text
        x={cell.x + 10 / scale}
        y={cell.y - 18 / scale}
        text={String(tag.name ?? tag.id)}
        fontSize={12 / scale}
        fill="#0f172a"
        listening={false}
      />
      {selected && interactive && (
        <Circle
          x={tip.x}
          y={tip.y}
          radius={5 / scale}
          fill={DRAFT_COLOR}
          stroke="#ffffff"
          strokeWidth={2}
          strokeScaleEnabled={false}
          perfectDrawEnabled={false}
          draggable
          onDragStart={drag.start}
          onDragMove={(event: Konva.KonvaEventObject<DragEvent>) => {
            const theta = headingBetween(cell, { x: event.target.x(), y: event.target.y() }, yaw);
            preview({ theta: Math.round(theta * 1000) / 1000 });
          }}
          onDragEnd={drag.end}
        />
      )}
    </>
  );
}

function ZoneShape({ zone, transforms, selected, interactive }: ShapeProps & { zone: MapZone }) {
  const select = useEditor(state => state.select);
  const key = selectionKey('zone', zone.id);
  const color = ZONE_STYLE[zone.type].color;
  return (
    <Line
      points={flat(zone.polygon, transforms)}
      closed
      fill={`${color}2e`}
      stroke={color}
      strokeWidth={selected ? 3 : 1.5}
      dash={zone.type === 'no_go' ? [] : [8, 4]}
      strokeScaleEnabled={false}
      perfectDrawEnabled={false}
      listening={interactive}
      onClick={() => select(key)}
      onTap={() => select(key)}
    />
  );
}

function PathShape({
  path,
  transforms,
  selected,
  interactive,
  scale,
}: ShapeProps & { path: MapPath }) {
  const select = useEditor(state => state.select);
  const key = selectionKey('path', path.id);
  const { color } = PATH_STYLE[path.type];
  const points = flat(path.points, transforms);
  return (
    <>
      <Line
        points={points}
        stroke={color}
        strokeWidth={path.width / transforms.resolution}
        opacity={path.type === 'virtual_wall' ? 0.7 : 0.25}
        lineCap="round"
        lineJoin="round"
        hitStrokeWidth={Math.max(path.width / transforms.resolution, 12 / scale)}
        listening={interactive}
        onClick={() => select(key)}
        onTap={() => select(key)}
      />
      <Line
        points={points}
        stroke={color}
        strokeWidth={selected ? 3 : 1.5}
        dash={path.type === 'preferred' ? [10, 6] : []}
        strokeScaleEnabled={false}
        listening={false}
      />
    </>
  );
}

interface ShapeProps {
  transforms: Transforms;
  scale: number;
  selected: boolean;
  interactive: boolean;
}

function DraftShape({ scale }: { scale: number }) {
  const draft = useEditor(state => state.draft);
  if (!draft) return null;
  const points: Point[] = draft.cursor ? [...draft.points, draft.cursor] : draft.points;
  const closes = draft.kind === 'zone' && draft.points.length >= 3;
  return (
    <>
      <Line
        points={points.flatMap(point => [point.x, point.y])}
        stroke={DRAFT_COLOR}
        strokeWidth={2}
        dash={[6, 4]}
        strokeScaleEnabled={false}
        listening={false}
      />
      {draft.points.map((point, index) => (
        <Circle
          // biome-ignore lint/suspicious/noArrayIndexKey: draft points are positional.
          key={index}
          x={point.x}
          y={point.y}
          radius={(index === 0 && closes ? 7 : 4) / scale}
          fill={index === 0 && closes ? '#ffffff' : DRAFT_COLOR}
          stroke={DRAFT_COLOR}
          strokeWidth={2}
          strokeScaleEnabled={false}
          perfectDrawEnabled={false}
          listening={false}
        />
      ))}
    </>
  );
}

// Zones, paths and tags over the map, in cells. With no tool active they can be selected, and the
// selected one gets handles.
export function FeaturesLayer({ scale }: { scale: number }) {
  const features = useEditor(state => state.features);
  const grid = useEditor(state => state.grid);
  const yaml = useEditor(state => state.yaml);
  const selectedId = useEditor(state => state.selectedId);
  const tool = useEditor(state => state.tool);
  if (!grid || !yaml) return null;
  const transforms = cellTransforms(grid, yaml);
  const interactive = tool === null;
  const selection = parseSelection(selectedId);
  const shared = { transforms, scale, interactive };
  const zone =
    selection?.kind === 'zone' ? features.zones?.find(item => item.id === selection.id) : undefined;
  const path =
    selection?.kind === 'path' ? features.paths?.find(item => item.id === selection.id) : undefined;
  return (
    <Layer>
      {(features.zones ?? []).map(item => (
        <ZoneShape key={item.id} zone={item} selected={item === zone} {...shared} />
      ))}
      {(features.paths ?? []).map(item => (
        <PathShape key={item.id} path={item} selected={item === path} {...shared} />
      ))}
      {(features.locationTags ?? []).map(tag => (
        <TagMarker
          key={String(tag.id)}
          tag={tag}
          selected={selectedId === selectionKey('tag', tag.id)}
          {...shared}
        />
      ))}
      {interactive && zone && (
        <VertexHandles
          kind="zone"
          id={zone.id}
          points={zone.polygon}
          field="polygon"
          color={ZONE_STYLE[zone.type].color}
          {...shared}
        />
      )}
      {interactive && path && (
        <VertexHandles
          kind="path"
          id={path.id}
          points={path.points}
          field="points"
          color={PATH_STYLE[path.type].color}
          {...shared}
        />
      )}
      <DraftShape scale={scale} />
    </Layer>
  );
}
