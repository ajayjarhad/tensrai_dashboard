import { expect, test } from 'bun:test';
import type { EmergencyAlert } from '@/features/robot-map/types';
import { describeEmergencyAlerts } from '@/features/robot-map/utils/emergencyAlertText';

const alert = (robotName: string, kind: EmergencyAlert['kind']): EmergencyAlert => ({
  id: `${kind}:${robotName}`,
  robotId: robotName,
  robotName,
  kind,
});

test('one robot reads as before', () => {
  expect(describeEmergencyAlerts([alert('Forklift A1', 'software')])).toBe(
    'Software emergency set on Forklift A1.'
  );
});

test('a fleet e-stop is one sentence naming every robot', () => {
  expect(
    describeEmergencyAlerts([
      alert('Forklift A1', 'software'),
      alert('Forklift A2', 'software'),
      alert('Real Python Robot', 'software'),
    ])
  ).toBe('Software emergency set on Forklift A1, Forklift A2, and Real Python Robot.');
});

test('hardware stops are named first, apart from software ones', () => {
  expect(
    describeEmergencyAlerts([alert('Forklift A1', 'software'), alert('Tugger', 'hardware')])
  ).toBe('Hardware emergency set on Tugger. Software emergency set on Forklift A1.');
});
