import { create } from 'zustand';
import { odomToPose } from '../lib/map/telemetryTransforms';
import {
  type CommandDispatchResult,
  type ConnectionStatus,
  createRobotWsClient,
} from '../services/robotWsClient';
import type {
  EmergencyCommand,
  LaserScan,
  ModeCommand,
  OdometryMessage,
  PathMessage,
  Pose2D,
  TeleopCommand,
} from '../types/telemetry';

const AMCL_LATCH_MS = 8000;
const TF_FRESH_MS = 4000;
const ODOM_MIN_INTERVAL_MS = 100;
const LASER_MIN_INTERVAL_MS = 160;
const PATH_MIN_INTERVAL_MS = 300;

type RobotTelemetry = {
  pose?: Pose2D;
  odomPose?: Pose2D;
  amclPose?: Pose2D;
  tfPose?: Pose2D;
  latchedPose?: Pose2D;
  latchedUntil?: number;
  laser?: LaserScan;
  laserPose?: Pose2D;
  path?: PathMessage;
  lastMessageAt?: number;
  lastOdomAt?: number;
  lastLaserAt?: number;
  lastPathAt?: number;
  lastAmclAt?: number;
  lastTfAt?: number;
  status: ConnectionStatus;
  poseSource?: 'odom' | 'amcl' | 'tf';
};

type TelemetryState = {
  telemetry: Record<string, RobotTelemetry>;
  connect: (robotId: string) => void;
  disconnect: (robotId: string) => void;
  clearPath: (robotId: string) => void;
  sendTeleop: (robotId: string, command: TeleopCommand) => CommandDispatchResult;
  sendMode: (robotId: string, command: ModeCommand) => CommandDispatchResult;
  sendEmergency: (robotId: string, command: EmergencyCommand) => CommandDispatchResult;
  sendInitialPose: (robotId: string, message: unknown) => CommandDispatchResult;
};

type TelemetrySet = (
  updater: (state: TelemetryState) => Partial<TelemetryState> | TelemetryState
) => void;

const clients = new Map<string, ReturnType<typeof createRobotWsClient>>();
const lastLaserDetailLogAt = new Map<string, number>();
const clientUnavailable = (): CommandDispatchResult => ({
  status: 'dropped',
  reason: 'client_unavailable',
});

const normalizeAngle = (theta: number) => {
  const twoPi = Math.PI * 2;
  let t = theta % twoPi;
  if (t > Math.PI) t -= twoPi;
  if (t < -Math.PI) t += twoPi;
  return t;
};

const isFinitePose = (pose: Pose2D | undefined): pose is Pose2D =>
  !!pose && Number.isFinite(pose.x) && Number.isFinite(pose.y) && Number.isFinite(pose.theta);

const tooSoon = (lastAt: number | undefined, minIntervalMs: number, now: number) =>
  !!lastAt && now - lastAt < minIntervalMs;

const isThrottled = (channel: string, current: RobotTelemetry, now: number) => {
  if (channel === 'odom') return tooSoon(current.lastOdomAt, ODOM_MIN_INTERVAL_MS, now);
  if (channel === 'laser') return tooSoon(current.lastLaserAt, LASER_MIN_INTERVAL_MS, now);
  if (channel === 'waypoints') return tooSoon(current.lastPathAt, PATH_MIN_INTERVAL_MS, now);
  return false;
};

const applyAmcl = (next: RobotTelemetry, amcl: OdometryMessage, now: number) => {
  const previous = next.amclPose;
  const amclPose = odomToPose(amcl);
  next.amclPose = amclPose;
  next.lastAmclAt = now;

  // If AMCL jumps significantly (e.g., after initialpose), latch the new pose for a short window
  // so it doesn't immediately snap back toward odom on the UI.
  const jumped =
    !previous ||
    Math.hypot(amclPose.x - previous.x, amclPose.y - previous.y) > 0.35 ||
    Math.abs(amclPose.theta - previous.theta) > 0.35;
  if (jumped) {
    next.latchedPose = amclPose;
    next.latchedUntil = now + AMCL_LATCH_MS;
  }
};

const applyOdomData = (next: RobotTelemetry, data: unknown, now: number) => {
  try {
    // Always drive pose from odom to avoid AMCL snap/auto-orient.
    next.odomPose = odomToPose(data as OdometryMessage);
    next.lastOdomAt = now;
  } catch {
    // ignore bad odom
  }
};

const applyTfPoseData = (next: RobotTelemetry, data: unknown, now: number) => {
  const pose = data as { x?: unknown; y?: unknown; theta?: unknown; yaw?: number } | null;
  if (typeof pose?.x === 'number' && typeof pose?.y === 'number') {
    next.tfPose = {
      x: pose.x,
      y: pose.y,
      theta: typeof pose.theta === 'number' ? pose.theta : (pose.yaw ?? 0),
    };
    next.lastTfAt = now;
  }
};

const applyAmclData = (next: RobotTelemetry, data: unknown, now: number) => {
  try {
    const amcl = data as OdometryMessage | null;
    if (amcl?.pose?.pose) applyAmcl(next, amcl, now);
  } catch {
    // ignore bad amcl
  }
};

const applyLaserData = (next: RobotTelemetry, data: unknown, now: number) => {
  const laser = data as LaserScan;
  next.laser = laser;
  next.lastLaserAt = now;
  if (isFinitePose(laser?.scanPose)) {
    next.laserPose = { ...laser.scanPose };
  } else {
    delete next.laserPose;
  }
};

const applyChannelData = (next: RobotTelemetry, channel: string, data: unknown, now: number) => {
  if (channel === 'odom') {
    applyOdomData(next, data, now);
  } else if (channel === 'pose') {
    applyTfPoseData(next, data, now);
  } else if (channel === 'amcl') {
    applyAmclData(next, data, now);
  } else if (channel === 'laser') {
    applyLaserData(next, data, now);
  } else if (channel === 'waypoints') {
    next.path = data as PathMessage;
    next.lastPathAt = now;
  }
};

const logLaserDetail = (robotId: string, next: RobotTelemetry, now: number) => {
  const lastLog = lastLaserDetailLogAt.get(robotId) ?? 0;
  if (now - lastLog < 2000) return;
  lastLaserDetailLogAt.set(robotId, now);

  const { laser, laserPose, pose: markerPose } = next;
  const renderPoseDelta =
    markerPose && laserPose
      ? {
          dx: markerPose.x - laserPose.x,
          dy: markerPose.y - laserPose.y,
          dist: Math.hypot(markerPose.x - laserPose.x, markerPose.y - laserPose.y),
          dTheta: normalizeAngle(markerPose.theta - laserPose.theta),
        }
      : null;
  console.log(
    '[laser]',
    JSON.stringify({
      stampMs: laser?.stampMs,
      frame: laser?.frame,
      scanPose: laser?.scanPose,
      scanPoseSource: laser?.scanPoseSource,
      pickedLaserPose: laserPose,
      markerPose,
      renderPoseDelta,
      tfPose: next.tfPose,
      amclPose: next.amclPose,
      latched: next.latchedPose,
    })
  );
};

const resolveDisplayPose = (next: RobotTelemetry, now: number) => {
  const tfFresh = next.lastTfAt ? now - next.lastTfAt < TF_FRESH_MS : false;

  let latchActive = next.latchedPose && next.latchedUntil && now < next.latchedUntil;
  if (latchActive && tfFresh && next.tfPose && next.latchedPose) {
    const dx = next.tfPose.x - next.latchedPose.x;
    const dy = next.tfPose.y - next.latchedPose.y;
    const dPos = Math.hypot(dx, dy);
    const dTheta = Math.abs(normalizeAngle(next.tfPose.theta - next.latchedPose.theta));
    if (dPos < 0.1 && dTheta < 0.1) {
      latchActive = false;
      delete next.latchedPose;
      delete next.latchedUntil;
    }
  }
  if (latchActive && next.latchedPose) {
    next.pose = next.latchedPose;
    next.poseSource = 'amcl';
  } else if (tfFresh && next.tfPose) {
    next.pose = next.tfPose;
    next.poseSource = 'tf';
  } else {
    if (next.amclPose) {
      next.pose = next.amclPose;
      next.poseSource = 'amcl';
    }
    delete next.latchedPose;
    delete next.latchedUntil;
  }
};

export const useRobotTelemetryStore = create<TelemetryState>(set => ({
  telemetry: {},

  connect: (robotId: string) => {
    if (!robotId) return;
    if (clients.has(robotId)) return;

    const client = createTelemetryClient(robotId, set);
    client.connect();
  },

  disconnect: (robotId: string) => {
    const client = clients.get(robotId);
    if (client) {
      client.disconnect();
      clients.delete(robotId);
    }
    set(state => {
      const next = { ...state.telemetry };
      delete next[robotId];
      return { telemetry: next };
    });
  },

  clearPath: (robotId: string) => {
    if (!robotId) return;
    set(state => {
      const current = state.telemetry[robotId];
      if (!current || (!current.path && current.lastPathAt === undefined)) return state;
      const nextRobot: RobotTelemetry = { ...current };
      delete nextRobot.path;
      delete nextRobot.lastPathAt;
      return {
        telemetry: {
          ...state.telemetry,
          [robotId]: nextRobot,
        },
      };
    });
  },

  sendTeleop: (robotId: string, command: TeleopCommand) => {
    const client = ensureTelemetryClient(robotId, set);
    return client ? client.sendCommand('teleop', command) : clientUnavailable();
  },

  sendMode: (robotId: string, command: ModeCommand) => {
    const client = ensureTelemetryClient(robotId, set);
    return client ? client.sendCommand('mode', command) : clientUnavailable();
  },

  sendEmergency: (robotId: string, command: EmergencyCommand) => {
    const client = ensureTelemetryClient(robotId, set);
    return client ? client.sendCommand('emergency', command) : clientUnavailable();
  },

  sendInitialPose: (robotId: string, message: unknown) => {
    const client = ensureTelemetryClient(robotId, set);
    return client ? client.sendCommand('initialpose', message) : clientUnavailable();
  },
}));

const createTelemetryClient = (robotId: string, set: TelemetrySet) => {
  const existing = clients.get(robotId);
  if (existing) return existing;

  const client = createRobotWsClient(robotId);
  clients.set(robotId, client);

  client.addStatusListener((status: ConnectionStatus) => {
    set((state: TelemetryState) => ({
      telemetry: {
        ...state.telemetry,
        [robotId]: {
          ...(state.telemetry[robotId] ?? { status: 'disconnected' }),
          status,
        },
      },
    }));
  });

  client.addEventListener(event => {
    if (event.type === 'error') {
      // Surface backend command errors (e.g., teleop rejected) for debugging.
      console.warn('Robot WS error', robotId, event.channel, event.requestId, event.message);
      return;
    }
    if (event.type !== 'event') return;

    set((state: TelemetryState) => {
      const now = Date.now();
      const current = state.telemetry[robotId] ?? { status: client.getStatus() };
      if (isThrottled(event.channel, current, now)) return state;

      const next: RobotTelemetry = { ...current, lastMessageAt: now };
      applyChannelData(next, event.channel, event.data, now);
      if (event.channel === 'laser') logLaserDetail(robotId, next, now);
      resolveDisplayPose(next, now);

      return {
        telemetry: {
          ...state.telemetry,
          [robotId]: next,
        },
      };
    });
  });

  return client;
};

const ensureTelemetryClient = (robotId: string, set: TelemetrySet) => {
  if (!robotId) return undefined;
  const client = createTelemetryClient(robotId, set);
  client.connect();
  return client;
};
