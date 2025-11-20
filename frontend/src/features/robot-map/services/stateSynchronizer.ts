/**
 * State Change Logger Service
 * Simple logging service for tracking state changes across components
 * Simplified from complex state synchronizer to focused logging
 */

import type { ViewportState } from '@tensrai/shared';

export interface StateChangeLog {
  timestamp: Date;
  component: string;
  action: string;
  entityId: string;
  data?: any;
}

const changeLogs: StateChangeLog[] = [];
const maxLogs = 100;

/**
 * Log a state change for debugging and monitoring
 */
export function logStateChange(
  component: string,
  action: string,
  entityId: string,
  data?: any
): void {
  const log: StateChangeLog = {
    timestamp: new Date(),
    component,
    action,
    entityId,
    data,
  };

  changeLogs.push(log);

  // Keep only recent logs to prevent memory leaks
  if (changeLogs.length > maxLogs) {
    changeLogs.splice(0, changeLogs.length - maxLogs);
  }

  // Log to console in development
  if (typeof window !== 'undefined' && (window as any).__DEV__) {
    console.debug(`[State Change] ${component}: ${action} - ${entityId}`, data);
  }
}

/**
 * Get recent state change logs
 */
export function getStateChangeLogs(limit: number = 50): StateChangeLog[] {
  return changeLogs.slice(-limit);
}

/**
 * Clear all state change logs
 */
export function clearStateChangeLogs(): void {
  changeLogs.length = 0;
}

/**
 * Get logs for a specific entity
 */
export function getEntityLogs(entityId: string): StateChangeLog[] {
  return changeLogs.filter(log => log.entityId === entityId);
}

/**
 * React hook for state change logging
 */
export function useStateLogger() {
  return {
    logViewportChange: (mapId: string, viewport: ViewportState, component: string = 'Unknown') => {
      logStateChange(component, 'viewport-update', mapId, viewport);
    },

    logRobotChange: (robotId: string, robotData: any, component: string = 'Unknown') => {
      logStateChange(component, 'robot-update', robotId, robotData);
    },

    getLogs: getStateChangeLogs,
    clearLogs: clearStateChangeLogs,
    getEntityLogs,
  };
}
