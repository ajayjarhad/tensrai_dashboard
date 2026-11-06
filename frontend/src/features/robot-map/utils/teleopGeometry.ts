const MAX_LINEAR = 0.333333; // fixed linear m/s
const MAX_ANGULAR = 0.333333; // fixed angular rad/s
const DEADZONE = 0.05; // pointer deadzone for small jitters
const KNOB_SIZE = 56; // px (tailwind h-14)
const POINTER_GAIN = 1.8; // amplifies drag so knob reaches edge quickly

export type DirectionControl = 'forward' | 'backward' | 'left' | 'right';
export type DirectionState = Record<DirectionControl, boolean>;
export type TeleopVector = { linear: number; angular: number };
export type KnobOffset = { x: number; y: number };
type JoystickPose = { vector: TeleopVector; knobOffset: KnobOffset };

export const createEmptyDirectionState = (): DirectionState => ({
  forward: false,
  backward: false,
  left: false,
  right: false,
});

const clampOffset = (x: number, y: number, allowed: number): KnobOffset => {
  if (allowed <= 0) return { x: 0, y: 0 };
  const mag = Math.hypot(x, y);
  if (mag <= allowed) return { x, y };
  const scale = allowed / mag;
  return { x: x * scale, y: y * scale };
};

const knobTravel = (radius: number) => Math.max(0, radius - KNOB_SIZE / 2);

export const joystickFromPointer = (
  pad: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  clientX: number,
  clientY: number
): JoystickPose => {
  const centerX = pad.left + pad.width / 2;
  const centerY = pad.top + pad.height / 2;
  const dx = clientX - centerX;
  const dy = clientY - centerY;
  const radius = pad.width / 2;
  const distance = Math.min(Math.hypot(dx, dy), radius);
  const allowed = knobTravel(radius);

  const normX = radius ? dx / radius : 0; // right is +, left is -
  const normY = radius ? dy / radius : 0; // down is +, up is -

  const scaledX = Math.max(-1, Math.min(1, normX * POINTER_GAIN));
  const scaledY = Math.max(-1, Math.min(1, normY * POINTER_GAIN));

  const linear = Math.abs(scaledY) > DEADZONE ? -Math.sign(scaledY) * MAX_LINEAR : 0;
  // ROS positive angular.z = left turn; invert so dragging right turns right (negative).
  const angular = Math.abs(scaledX) > DEADZONE ? -Math.sign(scaledX) * MAX_ANGULAR : 0;

  const reach = radius ? Math.min(1, distance / radius) : 0;
  return {
    vector: { linear, angular },
    knobOffset: clampOffset(scaledX * allowed * reach, scaledY * allowed * reach, allowed),
  };
};

export const joystickFromDirections = (pressed: DirectionState, radius: number): JoystickPose => {
  const linearDir = (pressed.forward ? 1 : 0) - (pressed.backward ? 1 : 0);
  let angular = 0;
  if (pressed.left && !pressed.right) {
    angular = MAX_ANGULAR;
  } else if (pressed.right && !pressed.left) {
    angular = -MAX_ANGULAR;
  }

  const allowed = knobTravel(radius);
  const rawX = angular !== 0 ? -Math.sign(angular) * allowed : 0;
  const rawY = linearDir !== 0 ? -linearDir * allowed : 0;
  return {
    vector: { linear: linearDir * MAX_LINEAR, angular },
    knobOffset: clampOffset(rawX, rawY, allowed),
  };
};
