import { describe, expect, test } from 'bun:test';
import { applyMissionEvent, applyMissionIntent, type MissionStatus } from '@tensrai/shared';

const T0 = Date.parse('2026-11-08T10:00:00.000Z');
const ms = (seconds: number) => T0 + seconds * 1000;
const at = (seconds: number) => new Date(ms(seconds)).toISOString();
const IDLE: MissionStatus = { status: 'idle', phase: 'idle' };

const event = (state: MissionStatus, name: string, payload: object, nowSeconds: number) =>
  applyMissionEvent(state, { event: name, payload }, ms(nowSeconds));
const intent = (
  state: MissionStatus,
  name: string,
  payload: object,
  nowSeconds: number,
  id: string
) => applyMissionIntent(state, name, payload as Record<string, unknown>, ms(nowSeconds), id);

const running = () =>
  event(
    intent(IDLE, 'START_MISSION', { missionId: 'm1' }, 0, 'q1'),
    'MISSION_START_ACK',
    {
      status: 'success',
      missionId: 'm1',
      requestId: 'q1',
      runId: 'run2',
      startedAt: at(1),
      timestamp: at(1),
    },
    1
  );
const showing = () =>
  event(
    intent(IDLE, 'SHOW_UP', { missionId: 'm1' }, 0, 'q1'),
    'MISSION_CONTROL_ACK',
    {
      requestType: 'SHOW_UP',
      status: 'success',
      missionId: 'm1',
      requestId: 'q1',
      timestamp: at(1),
    },
    1
  );

describe('mission lifecycle', () => {
  test('a start ack runs the mission it acknowledges', () => {
    expect(running()).toMatchObject({
      phase: 'running',
      currentMissionId: 'm1',
      runId: 'run2',
      waypointIndex: 0,
    });
  });

  test('pause and resume acks move the phase, and a cancel ack clears the run', () => {
    const control = (state: MissionStatus, requestType: string, seconds: number) =>
      event(
        state,
        'MISSION_CONTROL_ACK',
        { requestType, status: 'success', missionId: 'm1', timestamp: at(seconds) },
        seconds
      );
    const paused = control(running(), 'PAUSE', 2);
    const resumed = control(paused, 'RESUME', 3);
    const cancelled = control(resumed, 'CANCEL', 4);

    expect([paused.phase, resumed.phase, cancelled.phase]).toEqual([
      'paused',
      'running',
      'cancelled',
    ]);
    expect(cancelled).toMatchObject({
      currentMissionId: undefined,
      runId: undefined,
      startedAt: undefined,
    });
  });

  test('a report can clear the battery level, and a waypoint ack is timed by its time field', () => {
    const charged = event(
      running(),
      'ROBOT_STATUS_UPDATE',
      { batteryPercentage: 80, timestamp: at(2) },
      2
    );
    expect(
      event(charged, 'ROBOT_STATUS_UPDATE', { batteryPercentage: null, timestamp: at(3) }, 3)
        .batteryPercentage
    ).toBeNull();

    const late = event(
      running(),
      'WAYPOINT_ACK',
      { runId: 'run2', waypointIndex: 1, time: at(0.5), timestamp: at(5) },
      5
    );
    expect(late.waypointIndex).toBe(0);
  });

  test('an ack older than the last one is ignored', () => {
    const stale = event(
      running(),
      'MISSION_CONTROL_ACK',
      { requestType: 'PAUSE', status: 'success', timestamp: at(0.5) },
      2
    );
    expect(stale.phase).toBe('running');
  });
});

describe('the behaviour chosen where backend and frontend used to disagree', () => {
  test('a completion or waypoint from another run leaves the current run alone', () => {
    const current = running();
    expect(
      event(
        current,
        'MISSION_COMPLETED',
        { status: 'success', runId: 'run1', completionTime: at(2) },
        2
      )
    ).toBe(current);
    expect(
      event(current, 'WAYPOINT_ACK', { runId: 'run1', waypointIndex: 2, time: at(2) }, 2)
    ).toBe(current);
  });

  test('status reports keep their own clock, so commands and acks never make them stale', () => {
    const afterAck = event(
      running(),
      'ROBOT_STATUS_UPDATE',
      { batteryPercentage: 40, timestamp: at(0.5) },
      2
    );
    expect(afterAck.batteryPercentage).toBe(40);

    const pauseSent = intent(running(), 'PAUSE_MISSION', { missionId: 'm1' }, 10, 'q2');
    const robotBehind = event(
      pauseSent,
      'ROBOT_STATUS_UPDATE',
      {
        mission: { status: 'PAUSED', currentMissionId: 'm1' },
        batteryPercentage: 30,
        timestamp: at(8),
      },
      11
    );
    expect(robotBehind).toMatchObject({ phase: 'paused', batteryPercentage: 30 });
  });

  test('a new preview clears the last run’s progress', () => {
    const progressed = event(
      running(),
      'WAYPOINT_ACK',
      { runId: 'run2', waypointIndex: 2, totalWaypoints: 3, time: at(2) },
      2
    );
    expect(intent(progressed, 'SHOW_UP', { missionId: 'm2' }, 3, 'q2')).toMatchObject({
      phase: 'preview_pending',
      currentMissionId: 'm2',
      runId: undefined,
      startedAt: undefined,
      waypointIndex: undefined,
      totalWaypoints: undefined,
    });
  });

  test('a mode change command is not recorded', () => {
    const current = running();
    expect(intent(current, 'CHANGE_MODE', { mode: 'teleop' }, 2, 'q5')).toBe(current);
  });

  test('pending commands say what they are waiting for', () => {
    expect(intent(IDLE, 'SHOW_UP', { missionId: 'm1' }, 0, 'q1').message).toBe(
      'SHOW_UP sent… waiting for robot'
    );
    expect(intent(IDLE, 'START_MISSION', { missionId: 'm1' }, 0, 'q1').message).toBe(
      'Starting… waiting for robot ack'
    );
  });

  test('an idle report ends a preview only when it names a mission or a run', () => {
    const report = (mission: object) =>
      event(showing(), 'ROBOT_STATUS_UPDATE', { mission, timestamp: at(2) }, 2);
    expect(report({ status: 'IDLE', currentMissionId: null }).phase).toBe('showing');
    expect(report({ status: 'IDLE', runId: 'run9' }).phase).toBe('idle');
  });

  test('a report without mission information keeps the last mission id', () => {
    const idle = event(
      IDLE,
      'ROBOT_STATUS_UPDATE',
      { mission: { status: 'IDLE', currentMissionId: 'm1' }, timestamp: at(1) },
      1
    );
    expect(
      event(idle, 'ROBOT_STATUS_UPDATE', { batteryPercentage: 60, timestamp: at(2) }, 2)
        .currentMissionId
    ).toBe('m1');
  });

  test('an empty startedAt in a report is ignored', () => {
    const report = event(
      running(),
      'ROBOT_STATUS_UPDATE',
      { mission: { status: 'ACTIVE', currentMissionId: 'm1', startedAt: '' }, timestamp: at(2) },
      2
    );
    expect(report.startedAt).toBe(at(1));
  });

  test('a completion with no status reads as failed, not as the earlier success', () => {
    const done = event(running(), 'MISSION_COMPLETED', { runId: 'run2', completionTime: at(2) }, 2);
    expect(done).toMatchObject({ phase: 'failed', lastEventStatus: '' });
  });

  test('missionID is read as missionId', () => {
    const started = event(
      IDLE,
      'MISSION_START_ACK',
      { status: 'success', missionID: 'm3', timestamp: at(1) },
      1
    );
    expect(started).toMatchObject({ phase: 'running', currentMissionId: 'm3' });
  });

  test('an ack without a missionId belongs to the current mission', () => {
    const paused = event(
      running(),
      'MISSION_CONTROL_ACK',
      { requestType: 'PAUSE', status: 'success', timestamp: at(2) },
      2
    );
    expect(paused.lastEventMissionId).toBe('m1');
  });
});
