import type { Robot, RobotMode } from '@/types/robot';

export type RobotChannel = NonNullable<Robot['channels']>[number];

export type EditableRobot = Partial<Robot> & {
  id?: string;
  name: string;
  ipAddress?: string;
  bridgePort?: number;
  mappingBridgePort?: number;
  missionBridgePort?: number;
  emergencyBridgePort?: number;
  mapId?: string;
  status?: RobotMode;
  channels?: Robot['channels'];
};

export type MapOption = { id: string; name: string };

export const DEFAULT_ROBOT: EditableRobot = {
  name: '',
  ipAddress: '',
  bridgePort: 9090,
  mappingBridgePort: 8765,
  missionBridgePort: 9487,
  emergencyBridgePort: 8766,
  mapId: '',
  status: 'UNKNOWN' as RobotMode,
};

export const DEFAULT_CHANNELS: RobotChannel[] = [
  {
    name: 'odom',
    topic: '/odom_ui',
    msgType: 'nav_msgs/msg/Odometry',
    direction: 'subscribe',
    rateLimitHz: 5,
  },
  {
    name: 'laser',
    topic: '/scan_ui',
    msgType: 'sensor_msgs/msg/LaserScan',
    direction: 'subscribe',
    rateLimitHz: 3,
  },
  {
    name: 'waypoints',
    topic: '/plan_ui',
    msgType: 'nav_msgs/msg/Path',
    direction: 'subscribe',
    rateLimitHz: 2,
  },
  {
    name: 'teleop',
    topic: '/cmd_vel_ui',
    msgType: 'geometry_msgs/msg/Twist',
    direction: 'publish',
    connectionId: 'control',
  },
];

const toOptionalPort = (port: number | undefined) => (port ? Number(port) : undefined);

export const toRobotPayload = (form: EditableRobot, channels: RobotChannel[]) => ({
  name: form.name,
  ipAddress: form.ipAddress || undefined,
  bridgePort: toOptionalPort(form.bridgePort),
  mappingBridgePort: toOptionalPort(form.mappingBridgePort),
  missionBridgePort: toOptionalPort(form.missionBridgePort),
  emergencyBridgePort: toOptionalPort(form.emergencyBridgePort),
  status: form.status ?? 'UNKNOWN',
  channels: channels.length ? channels : undefined,
});

export type RobotPayload = ReturnType<typeof toRobotPayload>;
