import { afterEach, beforeEach, expect, type Mock, spyOn, test } from 'bun:test';
import type { MissionStatus } from '@tensrai/shared';
import { toast } from 'sonner';
import { toastMissionEvent } from '@/features/robot-map/utils/missionToasts';
import { type Robot, RobotMode } from '@/types/robot';

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

const robot: Robot = {
  id: 'r1',
  name: 'R1',
  status: RobotMode.AUTONOMOUS,
  lastSeen: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const toastsFor = (extra: Partial<MissionStatus>) => {
  toastMissionEvent(robot, { status: 'running', phase: 'running', ...extra }, 'Patrol');
  return shown;
};

const cancelled = { id: 'cancelled:r1' };

test.each([
  [
    { lastEvent: 'MISSION_START_ACK', lastEventStatus: 'success' },
    ['success', 'R1: Patrol started'],
  ],
  [
    { lastEvent: 'MISSION_START_ACK', lastEventStatus: 'error' },
    ['error', 'R1: Patrol failed to start'],
  ],
  [{ lastEvent: 'MISSION_START_ACK', message: 'robot busy' }, ['error', 'robot busy']],
  [
    { lastEvent: 'MISSION_CONTROL_ACK', lastEventStatus: 'success', lastRequestType: 'SHOW_UP' },
    ['success', 'R1: Patrol ready to start'],
  ],
  [
    { lastEvent: 'MISSION_CONTROL_ACK', lastEventStatus: 'success', lastRequestType: 'PAUSE' },
    ['message', 'R1: Patrol paused'],
  ],
  [
    { lastEvent: 'MISSION_CONTROL_ACK', lastEventStatus: 'success', lastRequestType: 'RESUME' },
    ['success', 'R1: Patrol resumed'],
  ],
  [
    { lastEvent: 'MISSION_CONTROL_ACK', lastEventStatus: 'success', lastRequestType: 'CANCEL' },
    ['message', 'R1: Patrol cancelled', cancelled],
  ],
  [
    { lastEvent: 'MISSION_CONTROL_ACK', lastEventStatus: 'error' },
    ['error', 'R1: Patrol control failed'],
  ],
  [
    { lastEvent: 'MISSION_COMPLETED', lastEventStatus: 'success' },
    ['success', 'R1: Patrol completed'],
  ],
  [
    { lastEvent: 'MISSION_COMPLETED', lastEventStatus: 'cancelled' },
    ['message', 'R1: Patrol cancelled', cancelled],
  ],
  [{ lastEvent: 'MISSION_COMPLETED', lastEventStatus: 'error' }, ['error', 'R1: Patrol failed']],
  [
    { lastEvent: 'MODE_CHANGE_ACK', lastEventStatus: 'success', mode: 'teleop' },
    ['message', 'R1: mode changed to teleop'],
  ],
  [
    { lastEvent: 'MODE_CHANGE_ACK', lastEventStatus: 'success' },
    ['message', 'R1: mode changed successfully'],
  ],
  [{ lastEvent: 'MODE_CHANGE_ACK', lastEventStatus: 'error' }, ['error', 'R1: mode change failed']],
  [
    { lastEvent: 'WAYPOINT_ACK', waypointIndex: 1, totalWaypoints: 3 },
    ['message', 'R1: Patrol: waypoint 2/3'],
  ],
  [{ lastEvent: 'WAYPOINT_ACK', waypointIndex: 1 }, ['message', 'R1: Patrol: waypoint reached']],
  [{ lastEvent: 'WAYPOINT_ACK', message: 'at dock' }, ['message', 'at dock']],
] satisfies [Partial<MissionStatus>, unknown[]][])('%o toasts %o', (extra, expected) => {
  expect(toastsFor(extra)).toEqual([expected]);
});

test.each([
  {
    lastEvent: 'MISSION_CONTROL_ACK',
    lastEventStatus: 'success',
    lastRequestType: 'START_MISSION',
  },
  { lastEvent: 'SOMETHING_ELSE' },
  { lastEvent: '__proto__' },
  {},
] satisfies Partial<MissionStatus>[])('%o shows no toast', extra => {
  expect(toastsFor(extra)).toEqual([]);
});
