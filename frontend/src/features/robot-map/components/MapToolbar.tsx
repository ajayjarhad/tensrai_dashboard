import { Maximize, Minus, Plus, RotateCcw, RotateCw } from 'lucide-react';

interface MapToolbarProps {
  className?: string;
  onZoomIn?: (() => void) | undefined;
  onZoomOut?: (() => void) | undefined;
  onRotateLeft?: (() => void) | undefined;
  onRotateRight?: (() => void) | undefined;
  onRecenter?: (() => void) | undefined;
}

export function MapToolbar({
  className,
  onZoomIn,
  onZoomOut,
  onRotateLeft,
  onRotateRight,
  onRecenter,
}: MapToolbarProps) {
  return (
    <div
      className={`flex flex-col gap-3 bg-card/90 backdrop-blur-sm p-3 rounded-lg shadow-md border border-border ${className || ''}`}
    >
      <div className="flex flex-col gap-2 border-b border-border/60 pb-3 mb-1">
        <button
          type="button"
          onClick={onZoomIn}
          className="p-2 hover:bg-muted rounded-md transition-colors text-foreground/80"
          title="Zoom In"
        >
          <Plus size={20} />
        </button>
        <button
          type="button"
          onClick={onZoomOut}
          className="p-2 hover:bg-muted rounded-md transition-colors text-foreground/80"
          title="Zoom Out"
        >
          <Minus size={20} />
        </button>
      </div>
      <div className="flex flex-col map-toolbar-rotate gap-2 border-b border-border/60 pb-3 mb-1">
        <button
          type="button"
          onClick={onRotateLeft}
          className="p-2 hover:bg-muted rounded-md transition-colors text-foreground/80"
          title="Rotate Left"
        >
          <RotateCcw size={20} />
        </button>
        <button
          type="button"
          onClick={onRotateRight}
          className="p-2 hover:bg-muted rounded-md transition-colors text-foreground/80"
          title="Rotate Right"
        >
          <RotateCw size={20} />
        </button>
      </div>
      <div>
        <button
          type="button"
          onClick={onRecenter}
          className="p-2 hover:bg-muted rounded-md transition-colors text-foreground/80"
          title="Recenter Map"
        >
          <Maximize size={20} />
        </button>
      </div>
    </div>
  );
}
