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
  PathMessage,
  Pose2D,
  TeleopCommand,
} from '../types/telemetry';

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

        if (
          event.channel === 'odom' &&
          current.lastOdomAt &&
          now - current.lastOdomAt < ODOM_MIN_INTERVAL_MS
        ) {
          return state;
        }
        if (
          event.channel === 'laser' &&
          current.lastLaserAt &&
          now - current.lastLaserAt < LASER_MIN_INTERVAL_MS
        ) {
          return state;
        }
        if (
          event.channel === 'waypoints' &&
          current.lastPathAt &&
          now - current.lastPathAt < PATH_MIN_INTERVAL_MS
        ) {
          return state;
        }

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
          const laser = event.data as LaserScan;
          next.laser = laser;
          next.lastLaserAt = now;
          if (laser?.scanPose) {
            next.laserPose = { ...laser.scanPose };
          } else if (next.tfPose) {
            next.laserPose = { ...next.tfPose };
          } else if (next.amclPose) {
            next.laserPose = { ...next.amclPose };
          }
          const lastLog = lastLaserDetailLogAt.get(robotId) ?? 0;
          if (now - lastLog >= 2000) {
            lastLaserDetailLogAt.set(robotId, now);
            console.log(
              '[laser]',
              JSON.stringify({
                stampMs: (laser as any)?.stampMs,
                ageVsNow: (laser as any)?.stampMs ? now - (laser as any).stampMs : null,
                frame: laser?.frame,
                scanPose: laser?.scanPose,
                tfPose: next.tfPose,
                amclPose: next.amclPose,
                latched: next.latchedPose,
                pickedLaserPose: next.laserPose,
              })
            );
          }
        } else if (event.channel === 'waypoints') {
          next.path = event.data as PathMessage;
          next.lastPathAt = now;
        } else if (event.channel === 'state') {
          // optional: map to status; for now, leave as is
        }

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
        } else if (next.amclPose) {
          next.pose = next.amclPose;
          next.poseSource = 'amcl';
          delete next.latchedPose;
          delete next.latchedUntil;
        } else {
          delete next.latchedPose;
          delete next.latchedUntil;
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
    const client = clients.get(robotId);
    return client ? client.sendCommand('teleop', command) : clientUnavailable();
  },

  sendMode: (robotId: string, command: ModeCommand) => {
    const client = clients.get(robotId);
    return client ? client.sendCommand('mode', command) : clientUnavailable();
  },

  sendEmergency: (robotId: string, command: EmergencyCommand) => {
    const client = clients.get(robotId);
    return client ? client.sendCommand('emergency', command) : clientUnavailable();
  },

  sendInitialPose: (robotId: string, message: unknown) => {
    const client = clients.get(robotId);
    return client ? client.sendCommand('initialpose', message) : clientUnavailable();
  },
}));
