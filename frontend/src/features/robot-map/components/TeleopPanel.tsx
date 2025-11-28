import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { TeleopCommand } from '@/types/telemetry';

type TeleopPanelProps = {
  robotId: string;
  robotName?: string;
  sendTeleop: (robotId: string, command: TeleopCommand) => void;
  onClose: () => void;
  className?: string;
  style?: CSSProperties;
};

const MAX_LINEAR = 0.333333; // fixed linear m/s
const MAX_ANGULAR = 0.333333; // fixed angular rad/s
const LOOP_MS = 100; // 10 Hz command rate
const DEADZONE = 0.05; // pointer deadzone for small jitters
const KNOB_SIZE = 56; // px (tailwind h-14)
const POINTER_GAIN = 1.8; // amplifies drag so knob reaches edge quickly

const zeroCommand: TeleopCommand = {
  linear: { x: 0, y: 0, z: 0 },
  angular: { x: 0, y: 0, z: 0 },
};

export function TeleopPanel({
  robotId,
  robotName,
  sendTeleop,
  onClose,
  className,
  style,
}: TeleopPanelProps) {
  const padRef = useRef<HTMLDivElement>(null);
  const [pointerActive, setPointerActive] = useState(false);
  const pointerIdRef = useRef<number | null>(null);
  const keysRef = useRef<Set<string>>(new Set());

  const [knobOffset, setKnobOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [vector, setVector] = useState<{ linear: number; angular: number }>({
    linear: 0,
    angular: 0,
  });

  const velocityRef = useRef(vector);
  velocityRef.current = vector;

  const clampOffset = useCallback((x: number, y: number, allowed: number) => {
    if (allowed <= 0) return { x: 0, y: 0 };
    const mag = Math.hypot(x, y);
    if (mag <= allowed) return { x, y };
    const scale = allowed / mag;
    return { x: x * scale, y: y * scale };
  }, []);

  const sendZero = useCallback(() => {
    sendTeleop(robotId, zeroCommand);
  }, [robotId, sendTeleop]);

  const stopAndReset = useCallback(() => {
    setVector({ linear: 0, angular: 0 });
    setKnobOffset({ x: 0, y: 0 });
    keysRef.current.clear();
    sendZero();
  }, [sendZero]);

  // Continuous send loop
  useEffect(() => {
    const loop = setInterval(() => {
      const { linear, angular } = velocityRef.current;
      sendTeleop(robotId, {
        linear: { x: linear, y: 0, z: 0 },
        angular: { x: 0, y: 0, z: angular },
      });
    }, LOOP_MS);
    return () => {
      clearInterval(loop);
      sendZero();
    };
  }, [robotId, sendTeleop, sendZero]);

  // Safety: stop on tab blur/visibility change
  useEffect(() => {
    const handleBlur = () => stopAndReset();
    const handleVisibility = () => {
      if (document.hidden) stopAndReset();
    };
    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [stopAndReset]);

  const updateVectorFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const pad = padRef.current;
      if (!pad) return;

      const rect = pad.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const dx = clientX - centerX;
      const dy = clientY - centerY;
      const radius = rect.width / 2;
      const distance = Math.min(Math.hypot(dx, dy), radius);
      const allowed = Math.max(0, radius - KNOB_SIZE / 2);

      const normX = radius ? dx / radius : 0; // right is +, left is -
      const normY = radius ? dy / radius : 0; // down is +, up is -

      const scaledX = Math.max(-1, Math.min(1, normX * POINTER_GAIN));
      const scaledY = Math.max(-1, Math.min(1, normY * POINTER_GAIN));

      const linear =
        Math.abs(scaledY) > DEADZONE ? -Math.sign(scaledY) * MAX_LINEAR : 0;
      // ROS positive angular.z = left turn; invert so dragging right turns right (negative).
      const angular =
        Math.abs(scaledX) > DEADZONE ? -Math.sign(scaledX) * MAX_ANGULAR : 0;

      setVector({ linear, angular });
      const rawX = scaledX * allowed * (radius ? Math.min(1, distance / radius) : 0);
      const rawY = scaledY * allowed * (radius ? Math.min(1, distance / radius) : 0);
      setKnobOffset(clampOffset(rawX, rawY, allowed));
    },
    [clampOffset]
  );

  // Pointer (touch/mouse) handling
  useEffect(() => {
    if (!pointerActive) return;

    const handleMove = (event: PointerEvent) => {
      if (pointerIdRef.current !== null && event.pointerId !== pointerIdRef.current) return;
      updateVectorFromPointer(event.clientX, event.clientY);
    };

    const handleUp = (event: PointerEvent) => {
      if (pointerIdRef.current !== null && event.pointerId !== pointerIdRef.current) return;
      pointerIdRef.current = null;
      setPointerActive(false);
      stopAndReset();
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);

    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [pointerActive, stopAndReset, updateVectorFromPointer]);

  // Keyboard handling (WASD + arrows)
  const updateVectorFromKeys = useCallback(() => {
    const keys = keysRef.current;
    const forward = keys.has('w') || keys.has('arrowup');
    const backward = keys.has('s') || keys.has('arrowdown');
    const left = keys.has('a') || keys.has('arrowleft');
    const right = keys.has('d') || keys.has('arrowright');

    const linearDir = (forward ? 1 : 0) - (backward ? 1 : 0);
    let angular = 0;
    if (left && !right) {
      angular = MAX_ANGULAR; // left turn = positive angular.z
    } else if (right && !left) {
      angular = -MAX_ANGULAR; // right turn = negative angular.z
    }

    const linear = linearDir * MAX_LINEAR;
    const padRect = padRef.current?.getBoundingClientRect();
    const radius = padRect ? padRect.width / 2 : 120;
    const allowed = Math.max(0, radius - KNOB_SIZE / 2);

    if (linearDir === 0 && angular === 0) {
      stopAndReset();
      return;
    }

    setVector({ linear, angular });
    const rawX = angular !== 0 ? -Math.sign(angular) * allowed : 0;
    const rawY = -linearDir * allowed;
    setKnobOffset(clampOffset(rawX, rawY, allowed));
  }, [clampOffset, stopAndReset]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const handled =
        key === 'w' ||
        key === 'a' ||
        key === 's' ||
        key === 'd' ||
        key.startsWith('arrow');

      if (!handled) return;

      if (event.target instanceof HTMLElement) {
        const tag = event.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        if (event.target.isContentEditable) return;
      }

      event.preventDefault();
      if (!keysRef.current.has(key)) {
        keysRef.current.add(key);
        updateVectorFromKeys();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (keysRef.current.has(key)) {
        keysRef.current.delete(key);
        updateVectorFromKeys();
      }
    };

    window.addEventListener('keydown', handleKeyDown, { passive: false });
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [updateVectorFromKeys]);

  return (
    <div
      className={cn(
        'absolute bottom-4 right-4 md:right-6 z-30 select-none',
        'max-w-[18rem] w-[18rem]',
        className
      )}
      style={style}
      aria-label="Teleoperation controls"
    >
      <div className="rounded-xl border border-border bg-card/95 backdrop-blur shadow-2xl p-4 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Manual Controlling
            </div>
            <div className="text-sm font-semibold text-foreground leading-tight">
              {robotName || robotId}
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => {
              stopAndReset();
              onClose();
            }}
            aria-label="Close teleop panel"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="relative w-full aspect-square">
          <div
            ref={padRef}
            className={cn(
              'absolute inset-0 rounded-full border border-border/80 bg-muted',
              'shadow-inner flex items-center justify-center touch-none'
            )}
            onPointerDown={event => {
              event.preventDefault();
              setPointerActive(true);
              pointerIdRef.current = event.pointerId;
              updateVectorFromPointer(event.clientX, event.clientY);
            }}
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
      </div>
    </div>
  );
}
