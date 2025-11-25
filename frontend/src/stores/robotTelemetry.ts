import { create } from 'zustand';
import type {
  Pose2D,
  LaserScan,
  PathMessage,
  TeleopCommand,
  EmergencyCommand,
  ModeCommand,
} from '../types/telemetry';
import { createRobotWsClient, type ConnectionStatus } from '../services/robotWsClient';
import { odomToPose, rosPoseToPose2D } from '../lib/map/telemetryTransforms';

type RobotTelemetry = {
  pose?: Pose2D;
  laser?: LaserScan;
  path?: PathMessage;
  lastMessageAt?: number;
  status: ConnectionStatus;
  poseSource?: 'odom' | 'amcl';
};

type TelemetryState = {
  telemetry: Record<string, RobotTelemetry>;
  connect: (robotId: string) => void;
  disconnect: (robotId: string) => void;
  sendTeleop: (robotId: string, command: TeleopCommand) => void;
  sendMode: (robotId: string, command: ModeCommand) => void;
  sendEmergency: (robotId: string, command: EmergencyCommand) => void;
};

const clients = new Map<string, ReturnType<typeof createRobotWsClient>>();

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
      if (event.type !== 'event') return;

      set(state => {
        const current = state.telemetry[robotId] ?? { status: client.getStatus() };
        const next: RobotTelemetry = { ...current, lastMessageAt: Date.now() };

        if (event.channel === 'odom') {
          try {
            // Always drive pose from odom to avoid AMCL snap/auto-orient.
            next.pose = odomToPose(event.data as any);
            next.poseSource = 'odom';
          } catch {
            // ignore bad odom
          }
        } else if (event.channel === 'laser') {
          next.laser = event.data as LaserScan;
        } else if (event.channel === 'waypoints') {
          next.path = event.data as PathMessage;
        } else if (event.channel === 'state') {
          // optional: map to status; for now, leave as is
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
}));
