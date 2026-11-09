import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import { applyMissionEvent, applyMissionIntent, type MissionStatus } from '@tensrai/shared';
import { useRobotMissionStore } from '@/stores/robotMission';
import type { Robot } from '@/types/robot';

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

describe('a robot whose clock is 3 seconds behind the server', () => {
  const robotAt = (seconds: number) => at(seconds - 3);

  test('its acks, waypoints and completions still land after a command', () => {
    const pending = intent(IDLE, 'START_MISSION', { missionId: 'm1' }, 10, 'q1');
    const started = event(
      pending,
      'MISSION_START_ACK',
      {
        status: 'success',
        missionId: 'm1',
        requestId: 'q1',
        runId: 'run1',
        timestamp: robotAt(10.2),
      },
      10.2
    );
    expect(started.phase).toBe('running');

    const pauseSent = intent(started, 'PAUSE_MISSION', { missionId: 'm1' }, 20, 'q2');
    const progressed = event(
      pauseSent,
      'WAYPOINT_ACK',
      { runId: 'run1', waypointIndex: 1, totalWaypoints: 3, time: robotAt(20.1) },
      20.1
    );
    const paused = event(
      progressed,
      'MISSION_CONTROL_ACK',
      { requestType: 'PAUSE', status: 'success', requestId: 'q2', timestamp: robotAt(20.2) },
      20.2
    );
    expect(paused).toMatchObject({ phase: 'paused', waypointIndex: 1 });

    const cancelSent = intent(paused, 'CANCEL_MISSION', { missionId: 'm1' }, 30, 'q3');
    const done = event(
      cancelSent,
      'MISSION_COMPLETED',
      { status: 'cancelled', runId: 'run1', completionTime: robotAt(30.1) },
      30.1
    );
    expect(done.phase).toBe('cancelled');
  });

  test('a command leaves the robot-event clock alone, so the ack that answers it still toasts', () => {
    const current = running();
    expect(intent(current, 'PAUSE_MISSION', { missionId: 'm1' }, 20, 'q2').lastEventAt).toBe(
      current.lastEventAt
    );
  });

  test('a server snapshot taken before a command does not undo it', () => {
    const startPending = intent(showing(), 'START_MISSION', { missionId: 'm1' }, 20, 'q2');
    setSystemTime(new Date(ms(21)));
    useRobotMissionStore.setState({ statusByRobot: { r1: startPending } });
    const snapshotFromBefore = {
      phase: 'showing',
      status: 'showing',
      currentMissionId: 'm1',
      updatedAt: at(1),
    };
    useRobotMissionStore
      .getState()
      .hydrateFromRobots([{ id: 'r1', mission: snapshotFromBefore } as unknown as Robot]);

    expect(useRobotMissionStore.getState().statusByRobot['r1']?.phase).toBe('start_pending');
  });
});

describe('merging a server snapshot, whatever this browser’s clock says', () => {
  afterEach(() => setSystemTime());

  const merge = (local: MissionStatus, snapshot: Record<string, unknown>) => {
    useRobotMissionStore.setState({ statusByRobot: { r1: local } });
    useRobotMissionStore
      .getState()
      .hydrateFromRobots([{ id: 'r1', mission: snapshot } as unknown as Robot]);
    return useRobotMissionStore.getState().statusByRobot['r1'];
  };

  test('a snapshot from before this browser’s command cannot undo it, with the browser 5 minutes behind', () => {
    const startSent = intent(showing(), 'START_MISSION', { missionId: 'm1' }, 20 - 300, 'q2');
    setSystemTime(new Date(ms(21 - 300)));
    const beforeCommand = {
      phase: 'showing',
      currentMissionId: 'm1',
      requestIdLast: 'q1',
      lastEventAt: ms(1),
      updatedAt: at(10),
    };

    expect(merge(startSent, beforeCommand)?.phase).toBe('start_pending');
  });

  test('a snapshot that has seen the command is merged, with the browser 5 minutes ahead', () => {
    const startSent = intent(showing(), 'START_MISSION', { missionId: 'm1' }, 20 + 300, 'q2');
    setSystemTime(new Date(ms(21 + 300)));
    const afterAck = {
      phase: 'running',
      currentMissionId: 'm1',
      runId: 'run1',
      requestIdLast: 'q2',
      lastEventAt: ms(22),
      updatedAt: at(22),
    };

    expect(merge(startSent, afterAck)?.phase).toBe('running');
  });

  test('a command that never reached the server stops blocking merges after 30 seconds', () => {
    const startSent = intent(showing(), 'START_MISSION', { missionId: 'm1' }, 20, 'q2');
    setSystemTime(new Date(ms(20 + 31)));
    const serverNeverSawIt = {
      phase: 'showing',
      currentMissionId: 'm1',
      requestIdLast: 'q1',
      lastEventAt: ms(1),
      updatedAt: at(40),
    };

    expect(merge(startSent, serverNeverSawIt)?.phase).toBe('showing');
  });

  test('a snapshot older than the robot events this client has seen is ignored', () => {
    const progressed = event(
      running(),
      'WAYPOINT_ACK',
      { runId: 'run2', waypointIndex: 1, time: at(5) },
      5
    );
    const older = {
      phase: 'paused',
      currentMissionId: 'm1',
      requestIdLast: 'q1',
      lastEventAt: ms(3),
      updatedAt: at(3),
    };

    expect(merge(progressed, older)?.phase).toBe('running');
  });

  test('an idle snapshot naming no mission or run leaves a local preview alone', () => {
    setSystemTime(new Date(ms(60)));
    const idle = {
      phase: 'idle',
      requestIdLast: 'q9',
      message: 'idle',
      lastEventAt: ms(2),
      lastSeenTs: ms(2),
      updatedAt: at(2),
    };

    expect(merge(showing(), idle)).toMatchObject({
      phase: 'showing',
      status: 'showing',
      currentMissionId: 'm1',
      requestIdLast: 'q1',
      message: 'SHOW_UP sent… waiting for robot',
      lastSeenTs: ms(2),
      runtimeUpdatedAt: ms(2),
      updatedAt: ms(2),
    });
  });

  test('robots without a snapshot, and snapshots that change nothing, leave the state as it was', () => {
    setSystemTime(new Date(ms(60)));
    useRobotMissionStore.setState({ statusByRobot: { r1: running() } });
    const before = useRobotMissionStore.getState().statusByRobot;

    useRobotMissionStore
      .getState()
      .hydrateFromRobots([
        { id: 'r2' } as unknown as Robot,
        { id: 'r1', mission: { phase: 'running' } } as unknown as Robot,
      ]);

    expect(useRobotMissionStore.getState().statusByRobot).toBe(before);
  });
});

describe('refused commands and reports that move the mission on', () => {
  test('a refused preview ends it, and a refused pause leaves the run and its progress', () => {
    const refusedPreview = event(
      intent(IDLE, 'SHOW_UP', { missionId: 'm1' }, 0, 'q1'),
      'MISSION_CONTROL_ACK',
      { requestType: 'SHOW_UP', status: 'failed', requestId: 'q1', timestamp: at(1) },
      1
    );
    expect(refusedPreview).toMatchObject({
      phase: 'idle',
      currentMissionId: 'm1',
      lastEventStatus: 'failed',
    });

    const progressed = event(
      running(),
      'WAYPOINT_ACK',
      { runId: 'run2', waypointIndex: 1, totalWaypoints: 3, time: at(2) },
      2
    );
    const refusedPause = event(
      progressed,
      'MISSION_CONTROL_ACK',
      { requestType: 'PAUSE_MISSION', status: 'failed', timestamp: at(3) },
      3
    );
    expect(refusedPause).toMatchObject({
      phase: 'running',
      currentMissionId: 'm1',
      runId: 'run2',
      waypointIndex: 1,
      totalWaypoints: 3,
      lastRequestType: 'PAUSE',
    });
  });

  test('a report naming another mission drops the old progress, and one naming the same mission updates it', () => {
    const progressed = event(
      running(),
      'WAYPOINT_ACK',
      { runId: 'run2', waypointIndex: 1, totalWaypoints: 3, time: at(2) },
      2
    );
    const report = (mission: object) =>
      event(progressed, 'ROBOT_STATUS_UPDATE', { mission, timestamp: at(3) }, 3);

    expect(
      report({
        status: 'ACTIVE',
        currentMissionId: 'm2',
        currentWaypointIndex: 0,
        totalWaypoints: 5,
      })
    ).toMatchObject({
      phase: 'running',
      currentMissionId: 'm2',
      runId: 'run2',
      waypointIndex: undefined,
      totalWaypoints: undefined,
    });
    expect(
      report({
        status: 'ACTIVE',
        currentMissionId: 'm1',
        currentWaypointIndex: 2,
        totalWaypoints: 3,
      })
    ).toMatchObject({
      phase: 'running',
      currentMissionId: 'm1',
      waypointIndex: 2,
      totalWaypoints: 3,
    });
  });

  test('an idle report naming no mission ends the run, and mode and charging come from the report', () => {
    const ended = event(
      running(),
      'ROBOT_STATUS_UPDATE',
      { mission: { status: 'IDLE' }, mode: 'teleop', chargingStatus: null, timestamp: at(2) },
      2
    );

    expect(ended).toMatchObject({
      phase: 'idle',
      currentMissionId: undefined,
      runId: undefined,
      startedAt: undefined,
      waypointIndex: undefined,
      mode: 'teleop',
      modeUpdatedAt: ms(2),
      chargingStatus: null,
    });
  });
});
