import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { cn } from '@/lib/utils';
import type { KnobOffset } from '../utils/teleopGeometry';

type TeleopJoystickPadProps = {
  padRef: RefObject<HTMLDivElement | null>;
  knobOffset: KnobOffset;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
};

export function TeleopJoystickPad({ padRef, knobOffset, onPointerDown }: TeleopJoystickPadProps) {
  return (
    <>
      <div className="relative w-full aspect-square">
        <div
          ref={padRef}
          className={cn(
            'absolute inset-0 rounded-full border border-border/80 bg-muted',
            'shadow-inner flex items-center justify-center touch-none'
          )}
          onPointerDown={onPointerDown}
        >
          <div className="absolute inset-[18%] rounded-full border border-border/60 opacity-50 pointer-events-none bg-white/10" />
          <div className="absolute inset-[36%] rounded-full border border-border/40 opacity-30 pointer-events-none bg-white/5" />
          <div
            className={cn(
              'absolute h-16 w-16 rounded-full',
              'bg-green-500 text-white',
              'shadow-[0_14px_30px_rgba(0,0,0,0.15)] border-4 border-green-200 ring-2 ring-green-200/80',
              'transition-transform duration-75 ease-linear will-change-transform'
            )}
            style={{
              transform: `translate(calc(-50% + ${knobOffset.x}px), calc(-50% + ${knobOffset.y}px))`,
              left: '50%',
              top: '50%',
            }}
          />
          <div className="pointer-events-none absolute h-28 w-28 rounded-full bg-green-400/15 blur-xl" />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Drag to move. Release to stop. Keyboard WASD/Arrow keys also work.
      </p>
    </>
  );
}
