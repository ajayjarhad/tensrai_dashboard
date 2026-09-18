import { expect, test } from 'bun:test';
import { shouldRearmEmergencyPopup } from '../src/lib/robotStatus';
import { RobotMode } from '../src/types/robot';

// Whether an "inactive" emergency reading is a genuine release (re-arm the one-time
// popup) or just a connection artefact (keep it suppressed).
test('re-arms on a genuine release: bridge connected and DB no longer e-stopped', () => {
  expect(shouldRearmEmergencyPopup('connected', RobotMode.TELEOP)).toBe(true);
});

test('does not re-arm on bridge disconnect', () => {
  expect(shouldRearmEmergencyPopup('disconnected', RobotMode.TELEOP)).toBe(false);
  expect(shouldRearmEmergencyPopup('error', RobotMode.TELEOP)).toBe(false);
  expect(shouldRearmEmergencyPopup('connecting', RobotMode.TELEOP)).toBe(false);
});

test('does not re-arm on the synthetic connected+inactive snapshot after a backend restart', () => {
  // Backend reconnects to the bridge and emits "connected" with cleared flags before the
  // real EMERGENCY_STATE arrives; the DB still says e-stopped.
  expect(shouldRearmEmergencyPopup('connected', RobotMode.SW_EMERGENCY)).toBe(false);
  expect(shouldRearmEmergencyPopup('connected', RobotMode.HW_EMERGENCY)).toBe(false);
});

test('does not re-arm when connection status is unknown', () => {
  expect(shouldRearmEmergencyPopup(undefined, RobotMode.TELEOP)).toBe(false);
  expect(shouldRearmEmergencyPopup('unconfigured', RobotMode.TELEOP)).toBe(false);
});
