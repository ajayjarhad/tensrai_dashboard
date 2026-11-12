import { afterEach, beforeEach, expect, type Mock, spyOn, test } from 'bun:test';
import type {
  FleetEmergencyDispatchResult,
  FleetEmergencyDispatchRobotResult,
} from '@tensrai/shared';
import { toast } from 'sonner';
import { notifyFleetEmergencyResult } from '@/features/robot-map/utils/fleetEmergency';

type ToastKind = 'success' | 'error' | 'message';

const shown: unknown[][] = [];
const spies: Mock<(...args: unknown[]) => string>[] = [];

beforeEach(() => {
  shown.length = 0;
  for (const kind of ['success', 'error', 'message'] satisfies ToastKind[]) {
    spies.push(
      spyOn(toast, kind).mockImplementation((...args: unknown[]) => {
        shown.push([kind, ...args]);
        return 'toast-id';
      })
    );
  }
});

afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

const entry = (
  robotName: string,
  applied: boolean,
  extra: Partial<FleetEmergencyDispatchRobotResult> = {}
): FleetEmergencyDispatchRobotResult => ({
  robotId: robotName.toLowerCase(),
  robotName,
  applied,
  connectionStatus: 'connected',
  softwareEmergencyActive: applied,
  hardwareEmergencyActive: false,
  effectiveEmergencyActive: applied,
  ...extra,
});

const notify = (
  desiredStatus: boolean,
  status: FleetEmergencyDispatchResult['status'],
  results: FleetEmergencyDispatchRobotResult[]
) => {
  notifyFleetEmergencyResult(desiredStatus, {
    desiredStatus,
    status,
    results,
    dispatchedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
  });
  return shown;
};

test('sending names up to three robots and counts the rest', () => {
  expect(notify(true, 'success', [entry('A', true), entry('B', true)])).toEqual([
    ['success', 'Emergency sent to A, B'],
  ]);
  shown.length = 0;
  const four = ['A', 'B', 'C', 'D'].map(name => entry(name, true));
  expect(notify(true, 'success', four)).toEqual([['success', 'Emergency sent to A, B, C +1 more']]);
});

test('sending to nobody falls back to a count', () => {
  expect(notify(true, 'success', [])).toEqual([['success', 'Emergency sent to 0 robots']]);
});

test('a partial send lists the failures', () => {
  const results = [entry('A', true), entry('B', false, { error: 'timeout' })];
  expect(notify(true, 'partial_failure', results)).toEqual([
    ['error', 'Emergency sent to A; 1 failed', { description: 'B: timeout' }],
  ]);
});

test('a failed send reports every robot, with unknown errors named', () => {
  const results = [entry('A', false), entry('B', false, { error: 'offline' })];
  expect(notify(true, 'failure', results)).toEqual([
    [
      'error',
      'Emergency command failed for all robots',
      { description: 'A: unknown error; B: offline' },
    ],
  ]);
});

test('a failed send with no robots has no description', () => {
  const [[, , options]] = notify(true, 'failure', []);
  expect(options).toStrictEqual({ description: undefined });
});

test('a failed release reports every robot', () => {
  expect(notify(false, 'failure', [entry('A', false, { error: 'offline' })])).toEqual([
    ['error', 'Release command failed for all robots', { description: 'A: offline' }],
  ]);
});

test('a release that leaves robots on hardware emergency says how many', () => {
  const locked = { hardwareEmergencyActive: true };
  expect(notify(false, 'success', [entry('A', true, locked)])).toEqual([
    ['message', 'Software emergency released; 1 robot remain stopped due to hardware emergency'],
  ]);
  shown.length = 0;
  expect(
    notify(false, 'partial_failure', [entry('A', true, locked), entry('B', true, locked)])
  ).toEqual([
    ['message', 'Software emergency released; 2 robots remain stopped due to hardware emergency'],
  ]);
});

test('a partial release lists the failures', () => {
  const results = [entry('A', true), entry('B', false, { error: 'offline' })];
  expect(notify(false, 'partial_failure', results)).toEqual([
    ['error', 'Release sent to A; 1 failed', { description: 'B: offline' }],
  ]);
});

test('a full release names the robots, or counts them when unnamed', () => {
  expect(notify(false, 'success', [entry('A', true)])).toEqual([['success', 'Release sent to A']]);
  shown.length = 0;
  expect(notify(false, 'success', [])).toEqual([['success', 'Release sent to 0 robots']]);
});
