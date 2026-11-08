import { expect, test } from 'bun:test';
import {
  getMissionState,
  hydrateMissionStateFromPersistedRun,
  updateMissionFromEvent,
} from './missionStatus.js';

const T0 = Date.parse('2026-11-08T10:00:00.000Z');
const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();

test('after a restart, a saved command’s server time does not hold back a lagging robot’s acks', () => {
  hydrateMissionStateFromPersistedRun('restart-robot', {
    missionId: 'm1',
    runId: 'run1',
    phase: 'RUNNING',
    lastEvent: 'PAUSE_MISSION',
    lastEventAt: at(20),
  });

  updateMissionFromEvent('restart-robot', 'MISSION_CONTROL_ACK', {
    requestType: 'PAUSE',
    status: 'success',
    missionId: 'm1',
    timestamp: at(17),
  });

  expect(getMissionState('restart-robot').phase).toBe('paused');
});
