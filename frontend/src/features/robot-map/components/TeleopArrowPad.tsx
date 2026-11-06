import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, type LucideIcon } from 'lucide-react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { cn } from '@/lib/utils';
import type { DirectionControl, DirectionState } from '../utils/teleopGeometry';

type ArrowPointerHandlers = {
  onDirectionDown: (
    direction: DirectionControl,
    event: ReactPointerEvent<HTMLButtonElement>
  ) => void;
  onDirectionRelease: (event: ReactPointerEvent<HTMLButtonElement>) => void;
};

type TeleopArrowPadProps = ArrowPointerHandlers & {
  pressed: DirectionState;
  onStop: () => void;
};

type DirectionButtonProps = ArrowPointerHandlers & {
  direction: DirectionControl;
  icon: LucideIcon;
  active: boolean;
};

function DirectionButton({
  direction,
  icon: Icon,
  active,
  onDirectionDown,
  onDirectionRelease,
}: DirectionButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        'h-full w-full rounded-xl border transition-colors touch-none',
        'flex items-center justify-center',
        active
          ? 'border-green-400 bg-green-500/20 text-green-700'
          : 'border-border bg-muted text-foreground hover:bg-muted/70'
      )}
      onPointerDown={event => onDirectionDown(direction, event)}
      onPointerUp={onDirectionRelease}
      onPointerCancel={onDirectionRelease}
    >
      <Icon className="h-6 w-6" />
    </button>
  );
}

export function TeleopArrowPad({ pressed, onStop, ...pointerHandlers }: TeleopArrowPadProps) {
  return (
    <>
      <div className="relative w-full aspect-square rounded-2xl border border-border bg-muted/50 p-2">
        <div className="grid h-full grid-cols-3 grid-rows-3 gap-2">
          <div />
          <DirectionButton
            direction="forward"
            icon={ArrowUp}
            active={pressed.forward}
            {...pointerHandlers}
          />
          <div />

          <DirectionButton
            direction="left"
            icon={ArrowLeft}
            active={pressed.left}
            {...pointerHandlers}
          />

          <button
            type="button"
            className="h-full w-full rounded-xl border border-destructive/60 bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors touch-none text-xs font-semibold"
            onPointerDown={event => {
              event.preventDefault();
              onStop();
            }}
            onClick={onStop}
          >
            STOP
          </button>

          <DirectionButton
            direction="right"
            icon={ArrowRight}
            active={pressed.right}
            {...pointerHandlers}
          />

          <div />
          <DirectionButton
            direction="backward"
            icon={ArrowDown}
            active={pressed.backward}
            {...pointerHandlers}
          />
          <div />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Hold a direction to move. Release to stop. Optimized for touch devices.
      </p>
    </>
  );
}
