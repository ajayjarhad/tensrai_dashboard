import { expect, test } from 'bun:test';
import { slugFromName } from '../src/features/staff/components/OrgTable';

test('an organization name becomes lowercase words joined by dashes', () => {
  expect(slugFromName('Organization A')).toBe('organization-a');
  expect(slugFromName('  Acme   Robotics, Inc.  ')).toBe('acme-robotics-inc');
});

test('accents are kept as plain letters', () => {
  expect(slugFromName('Café Münster')).toBe('cafe-munster');
});

test('a name with nothing usable gives an empty slug, so the required field asks for one', () => {
  expect(slugFromName('  ---  ')).toBe('');
});
