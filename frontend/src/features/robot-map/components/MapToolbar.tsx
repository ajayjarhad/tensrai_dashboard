import { Maximize, Minus, Plus, RotateCcw, RotateCw } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { cn } from '../../../lib/utils';

interface MapToolbarProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onRotateLeft: () => void;
  onRotateRight: () => void;
  onRecenter: () => void;
  className?: string;
}

interface ToolbarButtonProps {
  onClick: () => void;
  icon: ReactNode;
  label: string;
}

const ToolbarButton = memo(({ onClick, icon, label }: ToolbarButtonProps) => (
  <div className="group relative flex items-center">
    <button
      type="button"
      onClick={onClick}
      className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-700 shadow-md transition-colors hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 active:bg-gray-100"
      aria-label={label}
    >
      {icon}
    </button>
    {/* Tooltip */}
    <div className="pointer-events-none absolute right-full mr-2 hidden items-center rounded bg-gray-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-sm transition-opacity group-hover:block group-hover:opacity-100 whitespace-nowrap z-50">
      {label}
      <div className="absolute -right-1 top-1/2 -mt-1 h-2 w-2 rotate-45 bg-gray-900" />
    </div>
  </div>
));

ToolbarButton.displayName = 'ToolbarButton';

export function MapToolbar({
  onZoomIn,
  onZoomOut,
  onRotateLeft,
  onRotateRight,
  onRecenter,
  className = '',
}: MapToolbarProps) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <ToolbarButton onClick={onZoomIn} icon={<Plus className="h-4 w-4" />} label="Zoom In" />
      <ToolbarButton onClick={onZoomOut} icon={<Minus className="h-4 w-4" />} label="Zoom Out" />
      <ToolbarButton
        onClick={onRotateLeft}
        icon={<RotateCcw className="h-4 w-4" />}
        label="Rotate Left"
      />
      <ToolbarButton
        onClick={onRotateRight}
        icon={<RotateCw className="h-4 w-4" />}
        label="Rotate Right"
      />
      <ToolbarButton
        onClick={onRecenter}
        icon={<Maximize className="h-4 w-4" />}
        label="Fit to View"
      />
    </div>
  );
}
