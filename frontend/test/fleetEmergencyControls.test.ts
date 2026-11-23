import { expect, test } from 'bun:test';
import { isValidElement, type ReactNode } from 'react';
import { Button } from '../src/components/ui/button';
import {
  FleetEmergencyControls,
  type FleetEmergencyControlsProps,
} from '../src/features/emergency-stop/FleetEmergencyControls';

type ButtonProps = { children?: ReactNode; disabled?: boolean; onClick?: () => void };

const textOf = (node: ReactNode): string => {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join('');
  return isValidElement<ButtonProps>(node) ? textOf(node.props.children) : '';
};

const findButtons = (node: ReactNode): ButtonProps[] => {
  if (Array.isArray(node)) return node.flatMap(findButtons);
  if (!isValidElement<ButtonProps>(node)) return [];
  return node.type === Button ? [node.props] : findButtons(node.props.children);
};

// Reads the element tree rather than rendering it: there is no DOM here to click in, and the
// permission guard around the buttons is covered by its own rules.
const controlButtons = (props: FleetEmergencyControlsProps) =>
  Object.fromEntries(
    findButtons(FleetEmergencyControls(props)).map(button => [textOf(button.children), button])
  );

const labels = (props: FleetEmergencyControlsProps) => Object.keys(controlButtons(props));

const STOP = 'Emergency stop';
const partlyStopped = { canSendEmergency: true, canReleaseSoftware: true };

test('with a soft-stopped robot the fleet can still be stopped and released', () => {
  const { [STOP]: stop, Release } = controlButtons(partlyStopped);

  expect(stop?.disabled).toBe(false);
  expect(Release?.disabled).toBe(false);
});

test('the stop stays in the outer position so Release appearing does not move it', () => {
  expect(labels(partlyStopped)).toEqual(['Release', STOP]);
});

test('with nothing soft-stopped only the stop is offered', () => {
  expect(labels({ canSendEmergency: true, canReleaseSoftware: false })).toEqual([STOP]);
});

test('each button sends its own command', () => {
  const calls: string[] = [];
  const { [STOP]: stop, Release } = controlButtons({
    ...partlyStopped,
    onEmergencyAll: () => calls.push('emergency'),
    onReleaseSoftware: () => calls.push('release'),
  });

  stop?.onClick?.();
  Release?.onClick?.();

  expect(calls).toEqual(['emergency', 'release']);
});

test('a release waiting on its acks does not block the stop', () => {
  const { [STOP]: stop, Release } = controlButtons({
    ...partlyStopped,
    pendingDesiredStatus: false,
  });

  expect(stop?.disabled).toBe(false);
  expect(Release?.disabled).toBe(true);
});

test('a stop waiting on its acks disables both buttons', () => {
  const { [STOP]: stop, Release } = controlButtons({
    ...partlyStopped,
    pendingDesiredStatus: true,
  });

  expect(stop?.disabled).toBe(true);
  expect(Release?.disabled).toBe(true);
});

test('the stop is disabled when no robot can be reached', () => {
  const { [STOP]: stop } = controlButtons({ canSendEmergency: false, canReleaseSoftware: false });

  expect(stop?.disabled).toBe(true);
});
