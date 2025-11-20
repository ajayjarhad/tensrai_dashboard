/**
 * Enhanced Robot Position Synchronizer
 * Handles real-time position updates and trajectory management
 */

import type { ROSPoseStamped, RobotInfo, WorldPoint } from '@tensrai/shared';
import { useMultiMapStore } from '../stores/useMultiMapStore';
import type { PositionUpdate, RobotTrajectory, TrajectoryPoint } from '../types/position';

// Re-export types for backward compatibility
export type { TrajectoryPoint, RobotTrajectory, PositionUpdate };

const trajectories = new Map<string, RobotTrajectory>();
const positionHistory = new Map<string, TrajectoryPoint[]>();
const updateCallbacks = new Set<(update: PositionUpdate) => void>();
const trajectoryCallbacks = new Set<(robotId: string, trajectory: TrajectoryPoint[]) => void>();
const maxHistoryLength = 1000;
let cleanupInterval: ReturnType<typeof setTimeout> | null = null;
const lastUpdateTime = new Map<string, Date>();

/**
 * Calculate distance between two points
 */
function calculateDistance(p1: WorldPoint, p2: WorldPoint): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Get robot trajectory color
 */
function getRobotColor(robotId: string): string {
  const colors = [
    '#00ff00',
    '#ff0000',
    '#0000ff',
    '#ffff00',
    '#ff00ff',
    '#00ffff',
    '#ff8800',
    '#8800ff',
    '#00ff88',
    '#ff0088',
  ];

  let hash = 0;
  for (let i = 0; i < robotId.length; i++) {
    hash = robotId.charCodeAt(i) + ((hash << 5) - hash);
  }

  return colors[Math.abs(hash) % colors.length];
}

/**
 * Update robot in store with new position
 */
function updateRobotInStore(robotId: string, pose: ROSPoseStamped, timestamp: Date): void {
  const state = useMultiMapStore.getState();
  const existingRobot = state.robots.get(robotId);

  const robotInfo: RobotInfo = {
    id: robotId,
    name: existingRobot?.name || `Robot ${robotId}`,
    currentPose: pose,
    lastUpdate: timestamp,
    status: 'online',
  };

  state.updateRobot(robotId, robotInfo);
}

/**
 * Update robot trajectory
 */
function updateTrajectory(robotId: string, point: TrajectoryPoint): void {
  let trajectory = trajectories.get(robotId);

  if (!trajectory) {
    trajectory = {
      robotId,
      points: [],
      maxLength: 100,
      color: getRobotColor(robotId),
      visible: true,
      lastUpdate: new Date(),
    };
    trajectories.set(robotId, trajectory);
  }

  trajectory.points.push(point);
  trajectory.lastUpdate = new Date();

  if (trajectory.points.length > trajectory.maxLength) {
    trajectory.points.splice(0, trajectory.points.length - trajectory.maxLength);
  }

  trajectoryCallbacks.forEach(callback => {
    try {
      callback(robotId, trajectory?.points);
    } catch (error) {
      console.error('Error in trajectory callback:', error);
    }
  });
}

/**
 * Update robot position and maintain trajectory
 */
export function updateRobotPosition(robotId: string, pose: ROSPoseStamped, mapId?: string): void {
  const timestamp = new Date();
  const position = { x: pose.pose.position.x, y: pose.pose.position.y };

  const point: TrajectoryPoint = {
    position,
    timestamp,
    pose,
  };

  const history = positionHistory.get(robotId) || [];
  history.push(point);

  // Trim history if too long
  if (history.length > maxHistoryLength) {
    history.splice(0, history.length - maxHistoryLength);
  }

  positionHistory.set(robotId, history);
  lastUpdateTime.set(robotId, timestamp);

  updateTrajectory(robotId, point);

  updateRobotInStore(robotId, pose, timestamp);

  const update: PositionUpdate = { robotId, pose, timestamp };
  if (mapId) {
    update.mapId = mapId;
  }
  updateCallbacks.forEach(callback => {
    try {
      callback(update);
    } catch (error) {
      console.error('Error in position update callback:', error);
    }
  });
}

/**
 * Get robot position history
 */
export function getPositionHistory(robotId: string, maxLength?: number): TrajectoryPoint[] {
  const history = positionHistory.get(robotId) || [];
  return maxLength ? history.slice(-maxLength) : history;
}

/**
 * Get robot trajectory for rendering
 */
export function getTrajectory(robotId: string): TrajectoryPoint[] {
  const trajectory = trajectories.get(robotId);
  return trajectory ? trajectory.points : [];
}

/**
 * Get all active trajectories
 */
export function getAllTrajectories(): Map<string, TrajectoryPoint[]> {
  const result = new Map<string, TrajectoryPoint[]>();
  trajectories.forEach((trajectory, robotId) => {
    if (trajectory.visible && trajectory.points.length > 0) {
      result.set(robotId, trajectory.points);
    }
  });
  return result;
}

/**
 * Calculate robot speed based on recent positions
 */
export function calculateRobotSpeed(robotId: string, timeWindowMs: number = 5000): number {
  const history = getPositionHistory(robotId);
  if (history.length < 2) return 0;

  const now = Date.now();
  const recentHistory = history.filter(h => now - h.timestamp.getTime() <= timeWindowMs);

  if (recentHistory.length < 2) return 0;

  let totalDistance = 0;
  for (let i = 1; i < recentHistory.length; i++) {
    const prev = recentHistory[i - 1];
    const curr = recentHistory[i];
    const distance = calculateDistance(prev.position, curr.position);
    totalDistance += distance;
  }

  const timeSpan =
    (recentHistory[recentHistory.length - 1].timestamp.getTime() -
      recentHistory[0].timestamp.getTime()) /
    1000;
  return timeSpan > 0 ? totalDistance / timeSpan : 0;
}

/**
 * Set trajectory visibility
 */
export function setTrajectoryVisibility(robotId: string, visible: boolean): void {
  const trajectory = trajectories.get(robotId);
  if (trajectory) {
    trajectory.visible = visible;
  }
}

/**
 * Set trajectory maximum length
 */
export function setTrajectoryMaxLength(robotId: string, maxLength: number): void {
  const trajectory = trajectories.get(robotId);
  if (trajectory) {
    trajectory.maxLength = maxLength;
    if (trajectory.points.length > maxLength) {
      trajectory.points.splice(0, trajectory.points.length - maxLength);
    }
  }
}

/**
 * Clear robot trajectory
 */
export function clearTrajectory(robotId: string): void {
  const trajectory = trajectories.get(robotId);
  if (trajectory) {
    trajectory.points = [];
    trajectory.lastUpdate = new Date();
  }
}

/**
 * Clear all trajectories
 */
export function clearAllTrajectories(): void {
  trajectories.forEach(trajectory => {
    trajectory.points = [];
    trajectory.lastUpdate = new Date();
  });
}

/**
 * Add position update callback
 */
export function onPositionUpdate(callback: (update: PositionUpdate) => void): () => void {
  updateCallbacks.add(callback);
  return () => updateCallbacks.delete(callback);
}

/**
 * Add trajectory update callback
 */
export function onTrajectoryUpdate(
  callback: (robotId: string, trajectory: TrajectoryPoint[]) => void
): () => void {
  trajectoryCallbacks.add(callback);
  return () => trajectoryCallbacks.delete(callback);
}

/**
 * Get trajectory statistics
 */
export function getTrajectoryStats(robotId: string): {
  pointCount: number;
  duration: number;
  distance: number;
  averageSpeed: number;
  lastUpdate: Date | null;
} {
  const trajectory = trajectories.get(robotId);
  if (!trajectory || trajectory.points.length === 0) {
    return {
      pointCount: 0,
      duration: 0,
      distance: 0,
      averageSpeed: 0,
      lastUpdate: null,
    };
  }

  const points = trajectory.points;
  const pointCount = points.length;
  const duration = points[pointCount - 1].timestamp.getTime() - points[0].timestamp.getTime();

  let distance = 0;
  for (let i = 1; i < points.length; i++) {
    distance += calculateDistance(points[i - 1].position, points[i].position);
  }

  const averageSpeed = duration > 0 ? distance / (duration / 1000) : 0;

  return {
    pointCount,
    duration,
    distance,
    averageSpeed,
    lastUpdate: trajectory.lastUpdate,
  };
}

/**
 * Check if robot is active (updated recently)
 */
export function isRobotActive(robotId: string, timeoutMs: number = 10000): boolean {
  const lastUpdate = lastUpdateTime.get(robotId);
  if (!lastUpdate) return false;

  return Date.now() - lastUpdate.getTime() < timeoutMs;
}

/**
 * Get all active robots
 */
export function getActiveRobots(timeoutMs: number = 10000): string[] {
  const activeRobots: string[] = [];
  const now = Date.now();

  lastUpdateTime.forEach((lastUpdate, robotId) => {
    if (now - lastUpdate.getTime() < timeoutMs) {
      activeRobots.push(robotId);
    }
  });

  return activeRobots;
}

/**
 * Clean up old position data
 */
function startCleanupInterval(): void {
  if (cleanupInterval) return;

  cleanupInterval = setInterval(
    () => {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours ago

      positionHistory.forEach((history, robotId) => {
        const filteredHistory = history.filter(h => h.timestamp.getTime() > cutoff);
        if (filteredHistory.length !== history.length) {
          positionHistory.set(robotId, filteredHistory);
        }
      });

      const activeRobots = getActiveRobots(60000); // 1 minute
      const inactiveRobots = Array.from(trajectories.keys()).filter(
        robotId => !activeRobots.includes(robotId)
      );

      inactiveRobots.forEach(robotId => {
        const trajectory = trajectories.get(robotId);
        if (trajectory) {
          trajectory.visible = false;
        }
      });
    },
    5 * 60 * 1000
  ); // Run every 5 minutes
}

/**
 * Export trajectory data
 */
export function exportTrajectory(robotId: string): string {
  const trajectory = trajectories.get(robotId);
  if (!trajectory) {
    return JSON.stringify({ error: 'Trajectory not found' });
  }

  return JSON.stringify(
    {
      robotId,
      points: trajectory.points.map(p => ({
        position: p.position,
        timestamp: p.timestamp.toISOString(),
        pose: p.pose,
      })),
      stats: getTrajectoryStats(robotId),
    },
    null,
    2
  );
}

/**
 * Clean up resources
 */
export function cleanup(): void {
  // Clear all data structures
  positionHistory.clear();
  trajectories.clear();
  updateCallbacks.clear();
  trajectoryCallbacks.clear();
  lastUpdateTime.clear();

  // Clear interval timers if they exist
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

// Start cleanup interval
startCleanupInterval();

/**
 * Hook for accessing position synchronizer functionality
 */
export function usePositionSynchronizer() {
  return {
    updateRobotPosition,
    getTrajectory,
    getAllTrajectories,
    calculateSpeed: calculateRobotSpeed,
    getStats: getTrajectoryStats,
    isActive: isRobotActive,
    getActiveRobots,
    setTrajectoryVisibility,
    clearTrajectory,
    onPositionUpdate,
    onTrajectoryUpdate,
  };
}

export const positionSynchronizer = {
  getInstance: () => ({
    updateRobotPosition,
    getTrajectory,
    getAllTrajectories,
    calculateRobotSpeed,
    getTrajectoryStats,
    isRobotActive,
    getActiveRobots,
    setTrajectoryVisibility,
    setTrajectoryMaxLength,
    clearTrajectory,
    clearAllTrajectories,
    onPositionUpdate,
    onTrajectoryUpdate,
    exportTrajectory,
    cleanup,
  }),
  cleanup,
};
