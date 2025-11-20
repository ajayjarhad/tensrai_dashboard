/**
 * Position Synchronization Types
 * Type definitions for robot position tracking and trajectory management
 */

import type { ROSPoseStamped, WorldPoint } from '@tensrai/shared';

export interface TrajectoryPoint {
  position: WorldPoint;
  timestamp: Date;
  pose: ROSPoseStamped;
  velocity?: {
    linear: number;
    angular: number;
  };
}

export interface RobotTrajectory {
  robotId: string;
  points: TrajectoryPoint[];
  maxLength: number;
  color: string;
  visible: boolean;
  lastUpdate: Date;
}

export interface PositionUpdate {
  robotId: string;
  pose: ROSPoseStamped;
  timestamp: Date;
  mapId?: string;
}
