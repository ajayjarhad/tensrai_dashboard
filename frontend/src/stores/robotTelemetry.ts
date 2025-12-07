import { create } from 'zustand';
import { odomToPose } from '../lib/map/telemetryTransforms';
import { type ConnectionStatus, createRobotWsClient } from '../services/robotWsClient';
import type {
  EmergencyCommand,
  LaserScan,
  ModeCommand,
  PathMessage,
  Pose2D,
  TeleopCommand,
} from '../types/telemetry';

const SMOOTH_ALPHA = 0.25;
const TF_FRESH_MS = 4000;

type RobotTelemetry = {
  pose?: Pose2D;
  odomPose?: Pose2D;
  amclPose?: Pose2D;
  tfPose?: Pose2D;
  latchedPose?: Pose2D;
  latchedUntil?: number;
  laser?: LaserScan;
  path?: PathMessage;
  lastMessageAt?: number;
  lastOdomAt?: number;
  lastAmclAt?: number;
  lastTfAt?: number;
  status: ConnectionStatus;
  poseSource?: 'odom' | 'amcl' | 'tf';
};

type TelemetryState = {
  telemetry: Record<string, RobotTelemetry>;
  connect: (robotId: string) => void;
  disconnect: (robotId: string) => void;
  sendTeleop: (robotId: string, command: TeleopCommand) => void;
  sendMode: (robotId: string, command: ModeCommand) => void;
  sendEmergency: (robotId: string, command: EmergencyCommand) => void;
  sendInitialPose: (robotId: string, message: unknown) => void;
};

const clients = new Map<string, ReturnType<typeof createRobotWsClient>>();

const normalizeAngle = (theta: number) => {
  const twoPi = Math.PI * 2;
  let t = theta % twoPi;
  if (t > Math.PI) t -= twoPi;
  if (t < -Math.PI) t += twoPi;
  return t;
};

const smoothPose = (target: Pose2D, prev: Pose2D, alpha: number): Pose2D => {
  const clamped = Math.min(1, Math.max(0, alpha));
  const dx = target.x - prev.x;
  const dy = target.y - prev.y;
  const dTheta = normalizeAngle(target.theta - prev.theta);
  return {
    x: prev.x + dx * clamped,
    y: prev.y + dy * clamped,
    theta: normalizeAngle(prev.theta + dTheta * clamped),
  };
};

export const useRobotTelemetryStore = create<TelemetryState>(set => ({
  telemetry: {},

  connect: (robotId: string) => {
    if (!robotId) return;
    if (clients.has(robotId)) return;

    const client = createRobotWsClient(robotId);
    clients.set(robotId, client);

    client.addStatusListener(status => {
      set(state => ({
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
        console.warn('Robot WS error', robotId, event.channel, event.message);
        return;
      }
      if (event.type !== 'event') return;

      set(state => {
        const now = Date.now();
        const current = state.telemetry[robotId] ?? { status: client.getStatus() };
        const next: RobotTelemetry = { ...current, lastMessageAt: now };

        if (event.channel === 'odom') {
          try {
            // Always drive pose from odom to avoid AMCL snap/auto-orient.
            next.odomPose = odomToPose(event.data as any);
            next.lastOdomAt = now;
          } catch {
            // ignore bad odom
          }
        } else if (event.channel === 'pose') {
          const data = event.data as any;
          if (typeof data?.x === 'number' && typeof data?.y === 'number') {
            next.tfPose = {
              x: data.x,
              y: data.y,
              theta: typeof data.theta === 'number' ? data.theta : (data.yaw ?? 0),
            };
            next.lastTfAt = now;
          }
        } else if (event.channel === 'amcl') {
          try {
            const amcl = event.data as { pose?: { pose?: any } };
            if (amcl?.pose?.pose) {
              const prevAmcl = current.amclPose;
              next.amclPose = odomToPose(amcl as any);
              next.lastAmclAt = now;
              // If AMCL jumps significantly (e.g., after initialpose), latch the new pose for a short window
              // so it doesn't immediately snap back toward odom on the UI.
              if (prevAmcl && next.amclPose) {
                const dx = next.amclPose.x - prevAmcl.x;
                const dy = next.amclPose.y - prevAmcl.y;
                const dPos = Math.hypot(dx, dy);
                const dTheta = Math.abs(next.amclPose.theta - prevAmcl.theta);
                if (dPos > 0.35 || dTheta > 0.35) {
                  next.latchedPose = next.amclPose;
                  next.latchedUntil = now + 8000; // 8s latch
                }
              } else if (next.amclPose) {
                next.latchedPose = next.amclPose;
                next.latchedUntil = now + 8000;
              }
            }
          } catch {
            // ignore bad amcl
          }
        } else if (event.channel === 'laser') {
          next.laser = event.data as LaserScan;
        } else if (event.channel === 'waypoints') {
          next.path = event.data as PathMessage;
        } else if (event.channel === 'state') {
          // optional: map to status; for now, leave as is
        }

        // Keep AMCL "fresh" longer so an initialpose reset doesn't immediately fall back to odom.
        const amclFresh = next.lastAmclAt ? now - next.lastAmclAt < 5000 : false;
        const odomFresh = next.lastOdomAt ? now - next.lastOdomAt < 1500 : false;
        const tfFresh = next.lastTfAt ? now - next.lastTfAt < TF_FRESH_MS : false;

        // Latch logic: if we recently saw a big AMCL jump, hold it for the latch window.
        let latchActive = next.latchedPose && next.latchedUntil && now < next.latchedUntil;
        // Break latch early if odom shows clear motion away from the latched pose.
        if (latchActive && odomFresh && next.odomPose && next.latchedPose) {
          const dx = next.odomPose.x - next.latchedPose.x;
          const dy = next.odomPose.y - next.latchedPose.y;
          const dPos = Math.hypot(dx, dy);
          const dTheta = Math.abs(normalizeAngle(next.odomPose.theta - next.latchedPose.theta));
          if (dPos > 0.2 || dTheta > 0.2) {
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
        } else if (odomFresh && next.odomPose) {
          // Use odom for smoothness during motion; fall back to AMCL when odom is stale.
          next.pose = next.odomPose;
          next.poseSource = 'odom';
          delete next.latchedPose;
          delete next.latchedUntil;
        } else if (amclFresh && next.amclPose) {
          next.pose = next.amclPose;
          next.poseSource = 'amcl';
          delete next.latchedPose;
          delete next.latchedUntil;
        } else if (next.odomPose) {
          next.pose = next.odomPose;
          next.poseSource = 'odom';
          delete next.latchedPose;
          delete next.latchedUntil;
        } else if (next.amclPose) {
          next.pose = next.amclPose;
          next.poseSource = 'amcl';
          delete next.latchedPose;
          delete next.latchedUntil;
        } else {
          delete next.latchedPose;
          delete next.latchedUntil;
        }

        // Smooth the displayed pose to reduce visual jitter when updates are frequent.
        if (next.pose && current.pose && !(latchActive && next.latchedPose)) {
          next.pose = smoothPose(next.pose, current.pose, SMOOTH_ALPHA);
        }

        return {
          telemetry: {
            ...state.telemetry,
            [robotId]: next,
          },
        };
      });
    });

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

  sendTeleop: (robotId: string, command: TeleopCommand) => {
    const client = clients.get(robotId);
    client?.sendCommand('teleop', command);
  },

  sendMode: (robotId: string, command: ModeCommand) => {
    const client = clients.get(robotId);
    client?.sendCommand('mode', command);
  },

  sendEmergency: (robotId: string, command: EmergencyCommand) => {
    const client = clients.get(robotId);
    client?.sendCommand('emergency', command);
  },

  sendInitialPose: (robotId: string, message: unknown) => {
    const client = clients.get(robotId);
    client?.sendCommand('initialpose', message);
  },
}));
