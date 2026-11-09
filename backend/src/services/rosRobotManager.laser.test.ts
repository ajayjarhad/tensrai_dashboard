import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { RosChannelConfig } from './rosRobotManager.js';

const { RosRobotManager } = await import('./rosRobotManager.js');

const managers: InstanceType<typeof RosRobotManager>[] = [];
const originalConsoleLog = console.log;
let logLines: string[] = [];

beforeEach(() => {
  logLines = [];
  console.log = (line: unknown) => {
    logLines.push(String(line));
  };
});

afterEach(() => {
  while (managers.length > 0) managers.pop()?.stop();
  console.log = originalConsoleLog;
});

const createManager = (channels: RosChannelConfig[] = []) => {
  const manager = new RosRobotManager({
    id: 'robot-1',
    connections: [{ id: 'default', url: 'ws://127.0.0.1:9090' }],
    teleopLimits: { watchdogMs: 0 },
    channels,
  });
  managers.push(manager);
  return manager;
};

const logged = (tag: string) =>
  logLines.map(line => JSON.parse(line)).filter(entry => entry.tag === tag);

const stamp = (sec: number) => ({ sec, nanosec: 0 });
const SCAN_POSE_CHANNEL: RosChannelConfig = {
  name: 'scanPose',
  topic: '/scan_pose',
  msgType: 'geometry_msgs/msg/Pose2D',
  direction: 'subscribe',
};

test('a scan without ranges passes through unchanged and is reported once', () => {
  const manager = createManager();
  const raw = { header: { frame_id: 'laser' } };

  expect(manager['processLaser'](raw)).toBe(raw);
  manager['processLaser'](raw);

  expect(logged('laser-skip')).toEqual([
    { tag: 'laser-skip', reason: 'no-ranges', keys: ['header'] },
  ]);
});

test('a long scan is downsampled and carries its firmware pose and the default offset', () => {
  const manager = createManager();
  const ranges = Array.from({ length: 1000 }, (_, i) => i);

  const out = manager['processLaser']({
    ranges,
    angle_increment: 0.01,
    header: { stamp: stamp(10) },
    pose: { x: 1, y: 2, theta: 0.5 },
  });

  expect(out?.ranges).toEqual(ranges.filter((_, i) => i % 3 === 0));
  expect(out?.angle_increment).toBeCloseTo(0.03);
  expect(out).toMatchObject({
    laserOffset: { x: 0.12, y: 0, yaw: 0 },
    scanPose: { x: 1, y: 2, theta: 0.5 },
    scanPoseSource: 'firmware',
    frame: 'base_link',
    stampMs: 10_000,
  });
  expect(logged('scan-offset')).toEqual([
    {
      tag: 'scan-offset',
      scanFrameId: null,
      offsetSource: 'default',
      offset: { x: 0.12, y: 0, yaw: 0 },
      knownFrames: [],
    },
  ]);
  expect(logged('scan-pose')).toEqual([
    expect.objectContaining({
      stampMs: 10_000,
      stampKey: '10:0',
      scanPose: { x: 1, y: 2, theta: 0.5 },
      scanPoseSource: 'firmware',
      scanPoseChannelEnabled: false,
      sidecarAvailable: false,
      sidecarStampMs: null,
      sidecarAgeMs: null,
      scanInterval: null,
      amclExtrapolated: false,
      omegaRadPerSec: null,
      amclAgeVsScan: null,
      amclHistLen: 0,
    }),
  ]);
});

test('scan detail is throttled, while the interval between scans keeps being tracked', () => {
  const manager = createManager();
  const scan = (sec: number) => ({ ranges: [1], header: { stamp: stamp(sec) } });

  manager['processLaser'](scan(1));
  manager['processLaser'](scan(3));

  expect(logged('scan-pose')).toHaveLength(1);
  expect(logged('scan-offset')).toHaveLength(1);
  expect(manager['lastScanStampMs']).toBe(3_000);
});

test('a scan without a firmware pose takes the sidecar pose recorded for its stamp', () => {
  const manager = createManager();
  manager['processScanPose']({ header: { stamp: stamp(7) }, x: 3, y: 4, theta: 1 });

  const out = manager['processLaser']({ ranges: [1, 2], header: { stamp: stamp(7) } });

  expect(out).toMatchObject({ scanPose: { x: 3, y: 4, theta: 1 }, scanPoseSource: 'sidecar' });
  expect(logged('scan-pose')[0]).toMatchObject({ sidecarAvailable: true, sidecarStampMs: 7_000 });
});

test('a scan waits for its sidecar pose when the robot publishes one, then is sent with it', () => {
  const manager = createManager([SCAN_POSE_CHANNEL]);
  const sent: unknown[] = [];
  manager.on('channel-data', event => sent.push(event));

  const out = manager['processLaser']({ ranges: [1, 2], header: { stamp: stamp(8) } });

  expect(out).toBeUndefined();
  expect(manager['pendingLaserByStamp'].size).toBe(1);

  manager['processScanPose']({ header: { stamp: stamp(8) }, x: 5, y: 6, theta: 0.2 });

  expect(manager['pendingLaserByStamp'].size).toBe(0);
  expect(sent).toEqual([
    {
      channel: 'laser',
      data: expect.objectContaining({
        scanPose: { x: 5, y: 6, theta: 0.2 },
        scanPoseSource: 'sidecar',
      }),
    },
  ]);
});

test('a scan that may not wait falls back to the localized pose', () => {
  const manager = createManager([SCAN_POSE_CHANNEL]);
  manager['mapPose'] = { x: 9, y: 8, yaw: 0.7 };

  const out = manager['processLaser'](
    { ranges: [1], header: { stamp: stamp(9) } },
    { allowDefer: false }
  );

  expect(out).toMatchObject({ scanPose: { x: 9, y: 8, theta: 0.7 }, scanPoseSource: 'computed' });
});

test('a scan with no pose source at all is sent without a pose', () => {
  const manager = createManager();

  const out = manager['processLaser']({ ranges: [1], header: { stamp: stamp(9) } });

  expect(out).toMatchObject({ scanPoseSource: 'none' });
  expect(out?.scanPose).toBeUndefined();
});

const transform = (
  parent: string,
  child: string,
  sec: number,
  translation: { x?: number; y?: number },
  yaw = 0
) => ({
  header: { frame_id: parent, stamp: stamp(sec) },
  child_frame_id: child,
  transform: { translation, rotation: { z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) } },
});

test('transforms update the map, odom and base frames and keep stamped history', () => {
  const manager = createManager();

  manager['handleTfMessage']({
    transforms: [
      transform('map', 'odom', 5, { x: 1, y: 2 }),
      transform('odom', 'base_link', 5, { x: 3 }),
      transform('map', 'base_footprint', 0, { x: 7, y: 8 }),
    ],
  });

  expect(manager['mapToOdom']).toEqual({ x: 1, y: 2, yaw: 0, stampMs: 5_000 });
  expect(manager['mapToOdomHistory']).toEqual([{ x: 1, y: 2, yaw: 0, stampMs: 5_000 }]);
  expect(manager['odomToBase']).toEqual({ x: 3, y: 0, yaw: 0, stampMs: 5_000 });
  expect(manager['odomToBaseHistory']).toEqual([{ x: 3, y: 0, yaw: 0, stampMs: 5_000 }]);
  expect(manager['mapToBase']).toEqual({ x: 7, y: 8, yaw: 0, stampMs: undefined });
});

test('a static transform updates its frame without adding history', () => {
  const manager = createManager();

  manager['handleTfMessage']({ transforms: [transform('map', 'odom', 0, { x: 1 })] });

  expect(manager['mapToOdom']).toEqual({ x: 1, y: 0, yaw: 0, stampMs: undefined });
  expect(manager['mapToOdomHistory']).toEqual([]);
});

test('a sensor frame under the base is learned once, and a laser frame becomes the scan offset', () => {
  const manager = createManager();
  const laser = transform('base_link', 'laser', 0, { x: 0.2, y: -0.1 }, 0.5);

  manager['handleTfMessage']({
    transforms: [laser, laser, transform('base_link', 'camera', 0, { x: 0.3 })],
  });

  expect(manager['sensorOffsetsByFrame'].get('laser')?.x).toBe(0.2);
  expect(manager['sensorOffsetsByFrame'].get('laser')?.yaw).toBeCloseTo(0.5);
  expect(manager['laserToBase']).toEqual(manager['sensorOffsetsByFrame'].get('laser'));
  expect(manager['laserToBase']).not.toBe(manager['sensorOffsetsByFrame'].get('laser'));
  expect(logged('tf-static').map(entry => entry.child)).toEqual(['laser', 'camera']);
});

test('the scan offset follows the scan frame, and each change of source is reported', () => {
  const manager = createManager();
  manager['handleTfMessage']({
    transforms: [
      transform('base_link', 'laser', 0, { x: 0.2 }),
      transform('base_link', 'lidar_rear', 0, { x: -0.4 }),
    ],
  });
  const offsetFor = (frameId: string) =>
    manager['processLaser']({ ranges: [1], header: { frame_id: frameId } })?.laserOffset;

  expect(offsetFor('lidar_rear')).toEqual({ x: -0.4, y: 0, yaw: 0 });
  expect(offsetFor('base_link')).toEqual({ x: 0, y: 0, yaw: 0 });
  expect(offsetFor('unknown_frame')).toEqual({ x: 0.2, y: 0, yaw: 0 });
  expect(offsetFor('unknown_frame')).toEqual({ x: 0.2, y: 0, yaw: 0 });

  expect(
    logged('scan-offset').map(({ scanFrameId, offsetSource }) => [scanFrameId, offsetSource])
  ).toEqual([
    ['lidar_rear', 'frame_id'],
    ['base_link', 'identity'],
    ['unknown_frame', 'legacy'],
  ]);
});
