import type { ROSPose, ROSPoseStamped } from '@tensrai/shared';

export interface Pose2D {
  x: number;
  y: number;
  theta: number;
}

export interface LaserScan {
  angle_min: number;
  angle_max: number;
  angle_increment: number;
  range_min: number;
  range_max: number;
  ranges: number[];
  points?: Array<{ x: number; y: number }>;
  frame?: string;
}

export interface PathMessage {
  header?: {
    frame_id?: string;
  };
  poses: Array<ROSPoseStamped>;
}

export interface OdometryMessage {
  pose: {
    pose: ROSPose;
  };
  twist?: {
    twist: {
      linear: { x: number; y: number; z: number };
      angular: { x: number; y: number; z: number };
    };
  };
}

export interface TeleopCommand {
  linear: { x: number; y: number; z: number };
  angular: { x: number; y: number; z: number };
}

export interface EmergencyCommand {
  action: 'estop' | 'release' | 'hw_reset';
  stamp?: number;
}

export interface ModeCommand {
  mode: string;
}
