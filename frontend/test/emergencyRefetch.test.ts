import { expect, test } from 'bun:test';
import { emergencyChangeNeedsRefetch } from '@/lib/robotStatus';
import { type Robot, RobotMode } from '@/types/robot';

type Reading = { connection?: string; active?: boolean; status?: RobotMode };

const robot = ({ connection, active = false, status = RobotMode.AUTONOMOUS }: Reading) =>
  ({
    id: 'r1',
    status,
    ...(connection && {
      emergency: { connectionStatus: connection, effectiveEmergencyActive: active },
    }),
  }) as unknown as Robot;

// Feeds the readings in order, as successive renders would, and lists the ones that refetch.
const refetchesFor = (readings: Reading[]) => {
  const seen = new Map<string, string>();
  return readings.flatMap((reading, index) =>
    emergencyChangeNeedsRefetch(seen, [robot(reading)]) ? [index] : []
  );
};

test('a page load with a robot that is not e-stopped fetches nothing extra', () => {
  expect(
    refetchesFor([
      {},
      { connection: 'disconnected' },
      { connection: 'connecting' },
      { connection: 'connected' },
    ])
  ).toEqual([]);
});

test('the first connection refetches when the stored status is still an e-stop', () => {
  expect(
    refetchesFor([
      { connection: 'connecting', status: RobotMode.SW_EMERGENCY },
      { connection: 'connected', status: RobotMode.SW_EMERGENCY },
    ])
  ).toEqual([1]);
});

test('the first connection refetches when the robot reports an active e-stop', () => {
  expect(refetchesFor([{ connection: 'connected', active: true }])).toEqual([0]);
});

test('an e-stop engaged or released after connecting refetches', () => {
  expect(
    refetchesFor([
      { connection: 'connected' },
      { connection: 'connected', active: true },
      { connection: 'connected', active: false },
    ])
  ).toEqual([1, 2]);
});

test('after the first connection, every connection change refetches as before', () => {
  expect(
    refetchesFor([
      { connection: 'connected' },
      { connection: 'disconnected' },
      { connection: 'connecting' },
      { connection: 'connected' },
    ])
  ).toEqual([1, 2, 3]);
});

test('a robot that has never connected does not refetch on each reconnect attempt', () => {
  expect(
    refetchesFor([
      { connection: 'connecting' },
      { connection: 'error' },
      { connection: 'connecting' },
      { connection: 'disconnected' },
    ])
  ).toEqual([]);
});
