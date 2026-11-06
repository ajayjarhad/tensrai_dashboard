import { afterEach, expect, test } from 'bun:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { createTeleopPanel } from '../src/features/robot-map/utils/teleopPanel';

const CONFIRM_TIMEOUT_MS = 30;
const panels: ReturnType<typeof createTeleopPanel>[] = [];

afterEach(() => {
  while (panels.length > 0) panels.pop()?.dispose();
});

const setup = () => {
  const sent: string[] = [];
  const state = { openRobot: null as string | null };
  const panel = createTeleopPanel({
    sendModeChange: (robotId, targetMode) => sent.push(`${robotId}:${targetMode}`),
    onRobotChange: robotId => {
      state.openRobot = robotId;
    },
    confirmTimeoutMs: CONFIRM_TIMEOUT_MS,
  });
  panels.push(panel);
  return { panel, sent, state };
};

test('reopening after a confirmed close waits for the robot instead of closing', () => {
  const { panel, sent, state } = setup();

  panel.open('r1');
  panel.observeMode('teleop');
  panel.close();

  panel.open('r1');
  panel.observeMode('autonomous');

  expect(state.openRobot).toBe('r1');
  expect(sent).toEqual(['r1:teleopActive', 'r1:autonomousActive', 'r1:teleopActive']);
});

test('a robot that never confirms is handed back to autonomous when the panel times out', async () => {
  const { panel, sent, state } = setup();

  panel.open('r1');
  panel.observeMode('autonomous');
  await sleep(CONFIRM_TIMEOUT_MS * 2);

  expect(state.openRobot).toBeNull();
  expect(sent).toEqual(['r1:teleopActive', 'r1:autonomousActive']);
});

test('status updates while waiting do not postpone the confirm deadline', async () => {
  const { panel, state } = setup();

  panel.open('r1');
  for (let elapsed = 0; elapsed < CONFIRM_TIMEOUT_MS * 3; elapsed += CONFIRM_TIMEOUT_MS / 3) {
    panel.observeMode('autonomous');
    await sleep(CONFIRM_TIMEOUT_MS / 3);
  }

  expect(state.openRobot).toBeNull();
});

test('the deadline runs even when no status ever arrives', async () => {
  const { panel, sent, state } = setup();

  panel.open('r1');
  await sleep(CONFIRM_TIMEOUT_MS * 2);

  expect(state.openRobot).toBeNull();
  expect(sent).toEqual(['r1:teleopActive', 'r1:autonomousActive']);
});

test('a confirmation cancels the deadline', async () => {
  const { panel, sent, state } = setup();

  panel.open('r1');
  panel.observeMode('teleop');
  await sleep(CONFIRM_TIMEOUT_MS * 2);

  expect(state.openRobot).toBe('r1');
  expect(sent).toEqual(['r1:teleopActive']);
});

test('a robot that leaves teleop by itself closes the panel with nothing to hand back', () => {
  const { panel, sent, state } = setup();

  panel.open('r1');
  panel.observeMode('teleop');
  panel.observeMode('autonomous');

  expect(state.openRobot).toBeNull();
  expect(sent).toEqual(['r1:teleopActive']);
});

test('closing by hand cancels the deadline and hands the robot back once', async () => {
  const { panel, sent, state } = setup();

  panel.open('r1');
  panel.observeMode('autonomous');
  panel.close();
  await sleep(CONFIRM_TIMEOUT_MS * 2);

  expect(state.openRobot).toBeNull();
  expect(sent).toEqual(['r1:teleopActive', 'r1:autonomousActive']);
});

test('switching robots hands the previous one back', () => {
  const { panel, sent, state } = setup();

  panel.open('r1');
  panel.observeMode('teleop');
  panel.open('r2');

  expect(state.openRobot).toBe('r2');
  expect(sent).toEqual(['r1:teleopActive', 'r1:autonomousActive', 'r2:teleopActive']);
});

test('opening the robot that is already open sends nothing and keeps its confirmation', () => {
  const { panel, sent, state } = setup();

  panel.open('r1');
  panel.observeMode('teleop');
  panel.open('r1');
  panel.observeMode('autonomous');

  expect(state.openRobot).toBeNull();
  expect(sent).toEqual(['r1:teleopActive']);
});

test('forgetting a robot removed from the fleet closes the panel without a command', async () => {
  const { panel, sent, state } = setup();

  panel.open('r1');
  panel.forget();
  await sleep(CONFIRM_TIMEOUT_MS * 2);

  expect(state.openRobot).toBeNull();
  expect(sent).toEqual(['r1:teleopActive']);
});
