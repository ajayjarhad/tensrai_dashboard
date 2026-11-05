import { expect, test } from 'bun:test';
import { availableMapId } from '../src/features/robot-map/hooks/useRobotSelection';
import type { Robot } from '../src/types/robot';

const robot = (id: string, active: string | null, others: string[] = []) =>
  ({
    id,
    mapId: active,
    maps: [...(active ? [active] : []), ...others].map(mapId => ({
      id: mapId,
      name: mapId,
      isActive: mapId === active,
      isPinned: false,
      syncedAt: '',
    })),
  }) as unknown as Robot;

test('keeps the current map while a robot still has it, active or not', () => {
  const robots = [robot('first', 'a', ['b']), robot('second', 'c')];

  expect(availableMapId(robots, 'c')).toBe('c');
  expect(availableMapId(robots, 'b')).toBe('b');
});

test('keeps a map only known through the legacy single mapId', () => {
  const legacy = { id: 'old', mapId: 'a' } as unknown as Robot;

  expect(availableMapId([legacy], 'a')).toBe('a');
});

test('moves to the first remaining robot when the robot holding the map has left', () => {
  const remaining = [robot('no-map', null), robot('second', 'c')];

  expect(availableMapId(remaining, 'moved-away')).toBe('c');
});

test('starts on the first robot with a map, and has nothing to show when none has one', () => {
  expect(availableMapId([robot('no-map', null), robot('second', 'c')], null)).toBe('c');
  expect(availableMapId([robot('no-map', null)], 'moved-away')).toBeNull();
  expect(availableMapId([], 'moved-away')).toBeNull();
});
