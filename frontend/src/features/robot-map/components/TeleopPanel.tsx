import { X } from 'lucide-react';
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
import {
  createEmptyDirectionState,
  type DirectionControl,
  type DirectionState,
  joystickFromDirections,
  joystickFromPointer,
  type KnobOffset,
  type TeleopVector,
} from '../utils/teleopGeometry';
import { TeleopArrowPad } from './TeleopArrowPad';
import { TeleopJoystickPad } from './TeleopJoystickPad';

type TeleopPanelProps = {
  robotId: string;
  robotName?: string;
  sendTeleop: (robotId: string, command: TeleopCommand) => void;
  onClose: () => void;
  className?: string;
  style?: CSSProperties;
};

const parseTeleopRateHz = () => {
  const raw = Number(import.meta.env['VITE_ROS_TELEOP_RATE_HZ'] ?? 10);
  if (!Number.isFinite(raw)) return 10;
  // Keep the heartbeat below the backend 750 ms watchdog while avoiding extra traffic.
  return Math.min(10, Math.max(2, raw));
};

const TELEOP_RATE_HZ = parseTeleopRateHz();
const LOOP_MS = Math.round(1000 / TELEOP_RATE_HZ);

type ControlMode = 'joystick' | 'arrows';

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

  const [knobOffset, setKnobOffset] = useState<KnobOffset>({ x: 0, y: 0 });
  const [vector, setVector] = useState<TeleopVector>({ linear: 0, angular: 0 });
  const [controlMode, setControlMode] = useState<ControlMode>('joystick');
  const [pressedDirections, setPressedDirections] =
    useState<DirectionState>(createEmptyDirectionState);

  const velocityRef = useRef(vector);
  velocityRef.current = vector;
  const lastSentVelocityRef = useRef<TeleopVector | null>(null);

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
      lastSentVelocityRef.current = null;
    };
  }, [sendVelocity, sendZero]);

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

  const updateVectorFromPointer = useCallback((clientX: number, clientY: number) => {
    const pad = padRef.current;
    if (!pad) return;

    const pose = joystickFromPointer(pad.getBoundingClientRect(), clientX, clientY);
    setVector(pose.vector);
    setKnobOffset(pose.knobOffset);
  }, []);

  const syncPressedDirections = useCallback(() => {
    const keys = keysRef.current;
    const touch = touchDirectionCountsRef.current;
    const next: DirectionState = {
      forward: keys.has('w') || keys.has('arrowup') || touch.forward > 0,
      backward: keys.has('s') || keys.has('arrowdown') || touch.backward > 0,
      left: keys.has('a') || keys.has('arrowleft') || touch.left > 0,
      right: keys.has('d') || keys.has('arrowright') || touch.right > 0,
    };
    setPressedDirections(prev =>
      prev.forward === next.forward &&
      prev.backward === next.backward &&
      prev.left === next.left &&
      prev.right === next.right
        ? prev
        : next
    );
    return next;
  }, []);

  const applyDirectionalInputs = useCallback(() => {
    const pressed = syncPressedDirections();
    const padRect = padRef.current?.getBoundingClientRect();
    const pose = joystickFromDirections(pressed, padRect ? padRect.width / 2 : 120);

    setVector(pose.vector);
    setKnobOffset(pose.knobOffset);
    if (pose.vector.linear === 0 && pose.vector.angular === 0) sendZero();
  }, [sendZero, syncPressedDirections]);

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

  const handlePadPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setPointerActive(true);
    pointerIdRef.current = event.pointerId;
    updateVectorFromPointer(event.clientX, event.clientY);
  };

  // Pointer (touch/mouse) handling
  useEffect(() => {
    if (!pointerActive) return;

    const handleMove = (event: PointerEvent) => {
      if (pointerIdRef.current !== null && event.pointerId !== pointerIdRef.current) return;
      updateVectorFromPointer(event.clientX, event.clientY);
    };

    const handleUp = (event: PointerEvent) => {
      if (pointerIdRef.current !== null && event.pointerId !== pointerIdRef.current) return;
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
        applyDirectionalInputs();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (keysRef.current.has(key)) {
        keysRef.current.delete(key);
        applyDirectionalInputs();
      }
    };

    window.addEventListener('keydown', handleKeyDown, { passive: false });
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [applyDirectionalInputs]);

  const tabButtonClass = (active: boolean) =>
    cn(
      'rounded-md px-3 py-2 text-xs font-semibold transition-colors',
      active
        ? 'bg-background text-foreground shadow-sm'
        : 'text-muted-foreground hover:text-foreground hover:bg-background/60'
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
          <TeleopJoystickPad
            padRef={padRef}
            knobOffset={knobOffset}
            onPointerDown={handlePadPointerDown}
          />
        ) : (
          <TeleopArrowPad
            pressed={pressedDirections}
            onStop={stopAndReset}
            onDirectionDown={handleArrowPointerDown}
            onDirectionRelease={handleArrowPointerRelease}
          />
        )}
      </div>
    </div>
  );
}
