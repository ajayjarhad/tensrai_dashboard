import { expect, test } from 'bun:test';
import { isValidElement, type ReactNode } from 'react';
import { Button } from '../src/components/ui/button';
import { EmergencyHeader } from '../src/features/emergency-stop/emergency-header';

type ButtonProps = { children?: ReactNode; disabled?: boolean; onClick?: () => void };
type HeaderRender = { render: (props: object, ref: null) => ReactNode };

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
const headerButtons = (props: object) => {
  const tree = (EmergencyHeader as unknown as HeaderRender).render(props, null);
  return Object.fromEntries(findButtons(tree).map(button => [textOf(button.children), button]));
};

const labels = (props: object) => Object.keys(headerButtons(props));

const partlyStopped = { canSendEmergency: true, canReleaseSoftware: true };

test('with a soft-stopped robot the fleet can still be stopped and released', () => {
  const { Emergency, Release } = headerButtons(partlyStopped);

  expect(Emergency?.disabled).toBe(false);
  expect(Release?.disabled).toBe(false);
});

test('Emergency stays in the outer position so Release appearing does not move it', () => {
  expect(labels(partlyStopped)).toEqual(['Release', 'Emergency']);
});

test('with nothing soft-stopped only Emergency is offered', () => {
  expect(labels({ canSendEmergency: true, canReleaseSoftware: false })).toEqual(['Emergency']);
});

test('each button sends its own command', () => {
  const calls: string[] = [];
  const { Emergency, Release } = headerButtons({
    ...partlyStopped,
    onEmergencyAll: () => calls.push('emergency'),
    onReleaseSoftware: () => calls.push('release'),
  });

  Emergency?.onClick?.();
  Release?.onClick?.();

  expect(calls).toEqual(['emergency', 'release']);
});

test('a release waiting on its acks does not block Emergency', () => {
  const { Emergency, Release } = headerButtons({ ...partlyStopped, pendingDesiredStatus: false });

  expect(Emergency?.disabled).toBe(false);
  expect(Release?.disabled).toBe(true);
});

test('a stop waiting on its acks disables both buttons', () => {
  const { Emergency, Release } = headerButtons({ ...partlyStopped, pendingDesiredStatus: true });

  expect(Emergency?.disabled).toBe(true);
  expect(Release?.disabled).toBe(true);
});

test('Emergency is disabled when no robot can be reached', () => {
  const { Emergency } = headerButtons({ canSendEmergency: false, canReleaseSoftware: false });

  expect(Emergency?.disabled).toBe(true);
});
