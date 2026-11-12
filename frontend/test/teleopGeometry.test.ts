import { expect, test } from 'bun:test';
import {
  createEmptyDirectionState,
  joystickFromDirections,
  joystickFromPointer,
} from '../src/features/robot-map/utils/teleopGeometry';

const SPEED = 0.333333;
const pad = { left: 0, top: 0, width: 200, height: 200 };
const pressed = (...directions: Array<'forward' | 'backward' | 'left' | 'right'>) => ({
  ...createEmptyDirectionState(),
  ...Object.fromEntries(directions.map(direction => [direction, true])),
});

test('the centre of the pad commands nothing', () => {
  expect(joystickFromPointer(pad, 100, 100)).toEqual({
    vector: { linear: 0, angular: 0 },
    knobOffset: { x: 0, y: 0 },
  });
});

test('dragging up drives forward and dragging down drives backward', () => {
  expect(joystickFromPointer(pad, 100, 0).vector).toEqual({ linear: SPEED, angular: 0 });
  expect(joystickFromPointer(pad, 100, 200).vector).toEqual({ linear: -SPEED, angular: 0 });
});

test('dragging right turns right, which ROS calls negative angular', () => {
  expect(joystickFromPointer(pad, 200, 100).vector).toEqual({ linear: 0, angular: -SPEED });
  expect(joystickFromPointer(pad, 0, 100).vector).toEqual({ linear: 0, angular: SPEED });
});

test('jitter inside the deadzone is ignored and anything past it moves at full speed', () => {
  expect(joystickFromPointer(pad, 102, 100).vector.angular).toBe(0);
  expect(joystickFromPointer(pad, 103, 100).vector.angular).toBe(-SPEED);
});

test('the knob stays inside the pad on a diagonal drag far outside it', () => {
  const { knobOffset } = joystickFromPointer(pad, 900, -900);

  expect(Math.hypot(knobOffset.x, knobOffset.y)).toBeCloseTo(72);
  expect(knobOffset.x).toBeGreaterThan(0);
  expect(knobOffset.y).toBeLessThan(0);
});

test('a pad with no size keeps the knob centred', () => {
  expect(joystickFromPointer({ ...pad, width: 0 }, 50, 50).knobOffset).toEqual({ x: 0, y: 0 });
});

test('directions map to the same signs as the joystick', () => {
  expect(joystickFromDirections(pressed('forward'), 100)).toEqual({
    vector: { linear: SPEED, angular: 0 },
    knobOffset: { x: 0, y: -72 },
  });
  expect(joystickFromDirections(pressed('backward'), 100).vector.linear).toBe(-SPEED);
  expect(joystickFromDirections(pressed('left'), 100)).toEqual({
    vector: { linear: 0, angular: SPEED },
    knobOffset: { x: -72, y: 0 },
  });
  expect(joystickFromDirections(pressed('right'), 100).vector.angular).toBe(-SPEED);
});

test('opposite directions cancel out', () => {
  const stopped = { vector: { linear: 0, angular: 0 }, knobOffset: { x: 0, y: 0 } };

  expect(joystickFromDirections(pressed('forward', 'backward'), 100)).toEqual(stopped);
  expect(joystickFromDirections(pressed('left', 'right'), 100)).toEqual(stopped);
  expect(joystickFromDirections(pressed(), 100)).toEqual(stopped);
});
