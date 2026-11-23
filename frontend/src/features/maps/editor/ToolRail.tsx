import {
  Eraser,
  type LucideIcon,
  MapPin,
  Minus,
  Pencil,
  Pentagon,
  Plus,
  Route,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { BRUSH_SIZES, PAINT_TOOLS, type Tool, useEditor } from './editorStore';

export interface ToolSpec {
  tool: Tool;
  icon: LucideIcon;
  label: string;
  key: string;
  hint: string;
}

export const PAINT_TOOL_SPECS: ToolSpec[] = [
  {
    tool: 'draw',
    icon: Pencil,
    label: 'Draw',
    key: 'B',
    hint: 'paints obstacles; Shift-click draws a straight line',
  },
  { tool: 'eraser', icon: Eraser, label: 'Eraser', key: 'E', hint: 'clears to free space' },
];

export const SHAPE_TOOL_SPECS: ToolSpec[] = [
  {
    tool: 'zone',
    icon: Pentagon,
    label: 'Zone',
    key: 'Z',
    hint: 'no-go, work, named, trigger, pick or drop',
  },
  { tool: 'path', icon: Route, label: 'Path', key: 'P', hint: 'preferred path or virtual wall' },
  { tool: 'tag', icon: MapPin, label: 'Tag', key: 'T', hint: 'mission location or home' },
];

export function ToolButton({
  label,
  pressed,
  disabled,
  title,
  onClick,
  small,
  children,
}: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  small?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grid place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-ring-strong disabled:pointer-events-none disabled:opacity-40 aria-pressed:bg-foreground aria-pressed:text-background',
        small ? 'h-8 w-8 [&_svg]:h-4 [&_svg]:w-4' : 'h-10 w-10 [&_svg]:h-5 [&_svg]:w-5'
      )}
    >
      {children}
    </button>
  );
}

// One floating rail holds every tool; choosing the active tool again puts it down.
export function ToolRail({
  groups,
  paintDisabledReason,
}: {
  groups: ToolSpec[][];
  paintDisabledReason: string | null;
}) {
  const tool = useEditor(state => state.tool);
  const setTool = useEditor(state => state.setTool);
  return (
    <div
      role="toolbar"
      aria-label="Tools"
      aria-orientation="vertical"
      className="absolute left-4 top-4 z-10 flex flex-col gap-0.5 rounded-xl border border-border bg-card p-1.5 shadow-md"
    >
      {groups.map((specs, index) => (
        <div key={specs[0]?.tool ?? index} className="flex flex-col gap-0.5">
          {index > 0 && <span className="mx-1.5 my-1 h-px bg-border" />}
          {specs.map(({ tool: spec, icon: Icon, label, key, hint }) => {
            const disabled = PAINT_TOOLS.has(spec) && Boolean(paintDisabledReason);
            return (
              <ToolButton
                key={spec}
                label={`${label} (${key})`}
                title={disabled ? (paintDisabledReason ?? '') : `${label} (${key}): ${hint}`}
                pressed={tool === spec}
                disabled={disabled}
                onClick={() => setTool(tool === spec ? null : spec)}
              >
                <Icon aria-hidden />
              </ToolButton>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// The paint tools' one option: brush size, in cells and in centimetres.
export function BrushOptions({ resolution }: { resolution: number }) {
  const brushSize = useEditor(state => state.brushSize);
  const setBrushSize = useEditor(state => state.setBrushSize);
  const index = BRUSH_SIZES.indexOf(brushSize as (typeof BRUSH_SIZES)[number]);
  const step = (by: number) => {
    const next = BRUSH_SIZES[Math.max(0, Math.min(BRUSH_SIZES.length - 1, index + by))];
    if (next) setBrushSize(next);
  };
  return (
    <fieldset
      aria-label="Brush size"
      className="absolute left-[78px] top-[17px] z-10 flex h-[52px] items-center gap-0.5 rounded-xl border border-border bg-card px-2 text-[13px] shadow-md"
    >
      <span className="px-1.5 font-medium">Size</span>
      <ToolButton small label="Smaller ([)" disabled={index <= 0} onClick={() => step(-1)}>
        <Minus aria-hidden />
      </ToolButton>
      <span
        className="min-w-11 text-center font-mono text-xs tabular-nums"
        title={`${Math.round(brushSize * resolution * 100)} cm`}
      >
        {brushSize} px
      </span>
      <ToolButton
        small
        label="Larger (])"
        disabled={index >= BRUSH_SIZES.length - 1}
        onClick={() => step(1)}
      >
        <Plus aria-hidden />
      </ToolButton>
    </fieldset>
  );
}
