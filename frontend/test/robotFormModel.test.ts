import { expect, test } from 'bun:test';
import { DEFAULT_CHANNELS, toRobotPayload } from '@/features/admin/robotFormModel';
import { RobotMode } from '@/types/robot';

test('a filled form keeps its values and channels', () => {
  const payload = toRobotPayload(
    {
      name: 'R1',
      ipAddress: '10.0.0.5',
      bridgePort: 9090,
      mappingBridgePort: 8765,
      missionBridgePort: 9487,
      emergencyBridgePort: 8766,
      status: RobotMode.TELEOP,
    },
    DEFAULT_CHANNELS
  );

  expect(payload).toStrictEqual({
    name: 'R1',
    ipAddress: '10.0.0.5',
    bridgePort: 9090,
    mappingBridgePort: 8765,
    missionBridgePort: 9487,
    emergencyBridgePort: 8766,
    status: RobotMode.TELEOP,
    channels: DEFAULT_CHANNELS,
  });
});

test('blank fields become undefined and a missing status becomes UNKNOWN', () => {
  expect(toRobotPayload({ name: 'R1', ipAddress: '', bridgePort: 0 }, [])).toStrictEqual({
    name: 'R1',
    ipAddress: undefined,
    bridgePort: undefined,
    mappingBridgePort: undefined,
    missionBridgePort: undefined,
    emergencyBridgePort: undefined,
    status: 'UNKNOWN',
    channels: undefined,
  });
});
