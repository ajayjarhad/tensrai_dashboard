import { expect, test } from 'bun:test';
import { availableMapId } from '../src/features/robot-map/hooks/useRobotSelection';
import { resolveSelectionMap } from '../src/features/robot-map/utils/mapSelection';
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

const missions = [
  { id: 'on-active', mapId: 'a' },
  { id: 'on-other', mapId: 'b' },
  { id: 'unowned', mapId: 'z' },
];

test('selecting a mission follows it to any of the robot’s maps and keeps it', () => {
  const owner = robot('first', 'a', ['b']);

  expect(resolveSelectionMap(owner, 'on-other', missions)).toEqual({
    mapId: 'b',
    clearMission: false,
  });
  expect(resolveSelectionMap(owner, 'on-active', missions)).toEqual({
    mapId: 'a',
    clearMission: false,
  });
});

test('a mission on none of the robot’s maps stays on the active map and is cleared', () => {
  expect(resolveSelectionMap(robot('first', 'a', ['b']), 'unowned', missions)).toEqual({
    mapId: 'a',
    clearMission: true,
  });
});

test('with no mission selected the robot’s active map shows and nothing is cleared', () => {
  expect(resolveSelectionMap(robot('first', 'a', ['b']), null, missions)).toEqual({
    mapId: 'a',
    clearMission: false,
  });
});

test('a legacy robot with only a single mapId still resolves', () => {
  const legacy = { id: 'old', mapId: 'a' } as unknown as Robot;

  expect(resolveSelectionMap(legacy, 'on-active', missions).mapId).toBe('a');
});
