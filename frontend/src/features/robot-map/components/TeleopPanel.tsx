import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, X } from 'lucide-react';
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
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
const parseTeleopRateHz = () => {
  const raw = Number(import.meta.env['VITE_ROS_TELEOP_RATE_HZ'] ?? 10);
  if (!Number.isFinite(raw)) return 10;
  // Keep the heartbeat below the backend 750 ms watchdog while avoiding extra traffic.
  return Math.min(10, Math.max(2, raw));
};

const TELEOP_RATE_HZ = parseTeleopRateHz();
const LOOP_MS = Math.round(1000 / TELEOP_RATE_HZ);
const DEADZONE = 0.05; // pointer deadzone for small jitters
const KNOB_SIZE = 56; // px (tailwind h-14)
const POINTER_GAIN = 1.8; // amplifies drag so knob reaches edge quickly

type ControlMode = 'joystick' | 'arrows';
type DirectionControl = 'forward' | 'backward' | 'left' | 'right';
type DirectionState = Record<DirectionControl, boolean>;

const createEmptyDirectionState = (): DirectionState => ({
  forward: false,
  backward: false,
  left: false,
  right: false,
});

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
  const arrowPointerMapRef = useRef<Map<number, DirectionControl>>(new Map());
  const touchDirectionCountsRef = useRef<Record<DirectionControl, number>>({
    forward: 0,
    backward: 0,
    left: 0,
    right: 0,
  });

  const [knobOffset, setKnobOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [vector, setVector] = useState<{ linear: number; angular: number }>({
    linear: 0,
    angular: 0,
  });
  const [controlMode, setControlMode] = useState<ControlMode>('joystick');
  const [pressedDirections, setPressedDirections] =
    useState<DirectionState>(createEmptyDirectionState);

  const velocityRef = useRef(vector);
  velocityRef.current = vector;
  const lastSentVelocityRef = useRef<{ linear: number; angular: number } | null>(null);

  const clampOffset = useCallback((x: number, y: number, allowed: number) => {
    if (allowed <= 0) return { x: 0, y: 0 };
    const mag = Math.hypot(x, y);
    if (mag <= allowed) return { x, y };
    const scale = allowed / mag;
    return { x: x * scale, y: y * scale };
  }, []);

  const sendVelocity = useCallback(
    (linear: number, angular: number, options?: { force?: boolean }) => {
      const last = lastSentVelocityRef.current;
      const isZero = linear === 0 && angular === 0;
      const lastWasZero = !last || (last.linear === 0 && last.angular === 0);

      if (!options?.force && isZero && lastWasZero) return;

      sendTeleop(robotId, {
        linear: { x: linear, y: 0, z: 0 },
        angular: { x: 0, y: 0, z: angular },
      });
      lastSentVelocityRef.current = { linear, angular };
    },
    [robotId, sendTeleop]
  );

  const sendZero = useCallback(
    (options?: { force?: boolean }) => {
      if (options?.force) {
        sendTeleop(robotId, zeroCommand);
        lastSentVelocityRef.current = { linear: 0, angular: 0 };
        return;
      }
      sendVelocity(0, 0);
    },
    [robotId, sendTeleop, sendVelocity]
  );

  const markTeleopSessionClosed = useCallback(() => {
    lastSentVelocityRef.current = null;
  }, []);

  const stopAndReset = useCallback(() => {
    pointerIdRef.current = null;
    setPointerActive(false);
    setVector({ linear: 0, angular: 0 });
    setKnobOffset({ x: 0, y: 0 });
    keysRef.current.clear();
    arrowPointerMapRef.current.clear();
    touchDirectionCountsRef.current.forward = 0;
    touchDirectionCountsRef.current.backward = 0;
    touchDirectionCountsRef.current.left = 0;
    touchDirectionCountsRef.current.right = 0;
    setPressedDirections(createEmptyDirectionState());
    sendZero({ force: true });
  }, [sendZero]);

  // Continuous send loop
  useEffect(() => {
    const loop = setInterval(() => {
      const { linear, angular } = velocityRef.current;
      sendVelocity(linear, angular);
    }, LOOP_MS);
    return () => {
      clearInterval(loop);
      sendZero({ force: true });
      markTeleopSessionClosed();
    };
  }, [markTeleopSessionClosed, sendVelocity, sendZero]);

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

      const linear = Math.abs(scaledY) > DEADZONE ? -Math.sign(scaledY) * MAX_LINEAR : 0;
      // ROS positive angular.z = left turn; invert so dragging right turns right (negative).
      const angular = Math.abs(scaledX) > DEADZONE ? -Math.sign(scaledX) * MAX_ANGULAR : 0;

      setVector({ linear, angular });
      const rawX = scaledX * allowed * (radius ? Math.min(1, distance / radius) : 0);
      const rawY = scaledY * allowed * (radius ? Math.min(1, distance / radius) : 0);
      setKnobOffset(clampOffset(rawX, rawY, allowed));
    },
    [clampOffset]
  );

  const getCombinedDirectionState = useCallback((): DirectionState => {
    const keys = keysRef.current;
    const touch = touchDirectionCountsRef.current;
    return {
      forward: keys.has('w') || keys.has('arrowup') || touch.forward > 0,
      backward: keys.has('s') || keys.has('arrowdown') || touch.backward > 0,
      left: keys.has('a') || keys.has('arrowleft') || touch.left > 0,
      right: keys.has('d') || keys.has('arrowright') || touch.right > 0,
    };
  }, []);

  const syncPressedDirections = useCallback(() => {
    const next = getCombinedDirectionState();
    setPressedDirections(prev =>
      prev.forward === next.forward &&
      prev.backward === next.backward &&
      prev.left === next.left &&
      prev.right === next.right
        ? prev
        : next
    );
    return next;
  }, [getCombinedDirectionState]);

  const applyDirectionalInputs = useCallback(() => {
    const pressed = syncPressedDirections();
    const linearDir = (pressed.forward ? 1 : 0) - (pressed.backward ? 1 : 0);
    let angular = 0;
    if (pressed.left && !pressed.right) {
      angular = MAX_ANGULAR;
    } else if (pressed.right && !pressed.left) {
      angular = -MAX_ANGULAR;
    }

    const linear = linearDir * MAX_LINEAR;
    const padRect = padRef.current?.getBoundingClientRect();
    const radius = padRect ? padRect.width / 2 : 120;
    const allowed = Math.max(0, radius - KNOB_SIZE / 2);

    if (linearDir === 0 && angular === 0) {
      setVector({ linear: 0, angular: 0 });
      setKnobOffset({ x: 0, y: 0 });
      sendZero();
      return;
    }

    setVector({ linear, angular });
    const rawX = angular !== 0 ? -Math.sign(angular) * allowed : 0;
    const rawY = linearDir !== 0 ? -linearDir * allowed : 0;
    setKnobOffset(clampOffset(rawX, rawY, allowed));
  }, [clampOffset, sendZero, syncPressedDirections]);

  const handleArrowPointerDown = useCallback(
    (direction: DirectionControl, event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {}
      pointerIdRef.current = null;
      setPointerActive(false);

      const activePointers = arrowPointerMapRef.current;
      const existingDirection = activePointers.get(event.pointerId);
      if (existingDirection === direction) return;

      if (existingDirection) {
        touchDirectionCountsRef.current[existingDirection] = Math.max(
          0,
          touchDirectionCountsRef.current[existingDirection] - 1
        );
      }

      activePointers.set(event.pointerId, direction);
      touchDirectionCountsRef.current[direction] += 1;
      applyDirectionalInputs();
    },
    [applyDirectionalInputs]
  );

  const handleArrowPointerRelease = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const activePointers = arrowPointerMapRef.current;
      const direction = activePointers.get(event.pointerId);
      if (!direction) return;
      activePointers.delete(event.pointerId);
      touchDirectionCountsRef.current[direction] = Math.max(
        0,
        touchDirectionCountsRef.current[direction] - 1
      );
      applyDirectionalInputs();
    },
    [applyDirectionalInputs]
  );

  useEffect(() => {
    stopAndReset();
  }, [stopAndReset]);

  const selectControlMode = useCallback(
    (nextMode: ControlMode) => {
      if (nextMode === controlMode) return;
      stopAndReset();
      setControlMode(nextMode);
    },
    [controlMode, stopAndReset]
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
    applyDirectionalInputs();
  }, [applyDirectionalInputs]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const handled =
        key === 'w' || key === 'a' || key === 's' || key === 'd' || key.startsWith('arrow');

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

  const tabButtonClass = (active: boolean) =>
    cn(
      'rounded-md px-3 py-2 text-xs font-semibold transition-colors',
      active
        ? 'bg-background text-foreground shadow-sm'
        : 'text-muted-foreground hover:text-foreground hover:bg-background/60'
    );

  const arrowButtonClass = (active: boolean) =>
    cn(
      'h-full w-full rounded-xl border transition-colors touch-none',
      'flex items-center justify-center',
      active
        ? 'border-green-400 bg-green-500/20 text-green-700'
        : 'border-border bg-muted text-foreground hover:bg-muted/70'
    );

  return (
    <div
      className={cn(
        'absolute bottom-4 right-4 md:right-6 z-30 select-none',
        'max-w-[18rem] w-[18rem]',
        className
      )}
      style={style}
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

        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
          <button
            type="button"
            className={tabButtonClass(controlMode === 'joystick')}
            onClick={() => selectControlMode('joystick')}
          >
            Joystick
          </button>
          <button
            type="button"
            className={tabButtonClass(controlMode === 'arrows')}
            onClick={() => selectControlMode('arrows')}
          >
            Arrow Keys
          </button>
        </div>

        {controlMode === 'joystick' ? (
          <>
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
            <p className="text-xs text-muted-foreground">
              Drag to move. Release to stop. Keyboard WASD/Arrow keys also work.
            </p>
          </>
        ) : (
          <>
            <div className="relative w-full aspect-square rounded-2xl border border-border bg-muted/50 p-2">
              <div className="grid h-full grid-cols-3 grid-rows-3 gap-2">
                <div />
                <button
                  type="button"
                  className={arrowButtonClass(pressedDirections.forward)}
                  onPointerDown={event => handleArrowPointerDown('forward', event)}
                  onPointerUp={handleArrowPointerRelease}
                  onPointerCancel={handleArrowPointerRelease}
                >
                  <ArrowUp className="h-6 w-6" />
                </button>
                <div />

                <button
                  type="button"
                  className={arrowButtonClass(pressedDirections.left)}
                  onPointerDown={event => handleArrowPointerDown('left', event)}
                  onPointerUp={handleArrowPointerRelease}
                  onPointerCancel={handleArrowPointerRelease}
                >
                  <ArrowLeft className="h-6 w-6" />
                </button>

                <button
                  type="button"
                  className="h-full w-full rounded-xl border border-destructive/60 bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors touch-none text-xs font-semibold"
                  onPointerDown={event => {
                    event.preventDefault();
                    stopAndReset();
                  }}
                  onClick={() => stopAndReset()}
                >
                  STOP
                </button>

                <button
                  type="button"
                  className={arrowButtonClass(pressedDirections.right)}
                  onPointerDown={event => handleArrowPointerDown('right', event)}
                  onPointerUp={handleArrowPointerRelease}
                  onPointerCancel={handleArrowPointerRelease}
                >
                  <ArrowRight className="h-6 w-6" />
                </button>

                <div />
                <button
                  type="button"
                  className={arrowButtonClass(pressedDirections.backward)}
                  onPointerDown={event => handleArrowPointerDown('backward', event)}
                  onPointerUp={handleArrowPointerRelease}
                  onPointerCancel={handleArrowPointerRelease}
                >
                  <ArrowDown className="h-6 w-6" />
                </button>
                <div />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Hold a direction to move. Release to stop. Optimized for touch devices.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
