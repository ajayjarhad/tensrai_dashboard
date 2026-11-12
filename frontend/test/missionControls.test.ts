import { expect, test } from 'bun:test';
import { isMissionControlAllowedDuringEmergency } from '@/features/robot-map/utils/missionControls';

test('during an e-stop a mission can still be cancelled, but not resumed or paused', () => {
  expect(isMissionControlAllowedDuringEmergency('CANCEL_MISSION')).toBe(true);
  expect(isMissionControlAllowedDuringEmergency('RESUME_MISSION')).toBe(false);
  expect(isMissionControlAllowedDuringEmergency('PAUSE_MISSION')).toBe(false);
});
