/**
 * Robot Telemetry Types
 * Type definitions for robot telemetry data, aggregations, and alerts
 */

import type { ROSPoseStamped, WorldPoint } from '@tensrai/shared';

export interface RobotTelemetry {
  robotId: string;
  timestamp: Date;
  pose: ROSPoseStamped;
  velocity: {
    linear: { x: number; y: number; z: number };
    angular: { x: number; y: number; z: number };
  };
  battery: {
    level: number;
    voltage: number;
    current: number;
    charging: boolean;
    timeRemaining?: number;
  };
  sensors: {
    bumper: boolean;
    cliff: boolean;
    wheelDrop: boolean;
    irSensor: number[];
    ultrasonic: number[];
    camera?: {
      enabled: boolean;
      fps: number;
      resolution: string;
    };
    lidar?: {
      enabled: boolean;
      scanRate: number;
      points: number;
    };
  };
  navigation: {
    state: 'idle' | 'moving' | 'navigating' | 'stuck' | 'error';
    goalReached: boolean;
    goalPosition?: WorldPoint;
    pathLength?: number;
    pathProgress?: number;
    replanningCount: number;
  };
  system: {
    cpuUsage: number;
    memoryUsage: number;
    temperature: number;
    uptime: number;
    lastReboot?: Date;
  };
  connectivity: {
    wifiSignal: number;
    connectionQuality: 'excellent' | 'good' | 'fair' | 'poor';
    latency: number;
    packetLoss: number; // percentage
    lastPingTime: Date;
  };
  tasks: {
    currentTask?: string;
    taskProgress: number; // percentage
    tasksCompleted: number;
    tasksFailed: number;
    totalDistanceTraveled: number; // meters
  };
}

export interface TelemetryAggregation {
  robotId: string;
  timeRange: {
    start: Date;
    end: Date;
  };
  samples: number;
  pose: {
    distanceTraveled: number;
    averageSpeed: number;
    maxSpeed: number;
    totalRotations: number;
  };
  battery: {
    averageLevel: number;
    minLevel: number;
    maxLevel: number;
    dischargeRate: number;
  };
  navigation: {
    successRate: number;
    averagePathLength: number;
    averageTimeToGoal: number;
    stuckCount: number;
  };
  system: {
    averageCpuUsage: number;
    peakCpuUsage: number;
    averageMemoryUsage: number;
    peakMemoryUsage: number;
    averageTemperature: number;
    maxTemperature: number;
  };
}

export interface TelemetryAlert {
  id: string;
  robotId: string;
  type: 'threshold' | 'trend' | 'anomaly' | 'offline';
  metric: string;
  value: number;
  threshold?: number;
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: Date;
  acknowledged: boolean;
}

// Telemetry State and Action Interfaces
export interface TelemetryState {
  telemetry: Map<string, RobotTelemetry[]>;
  latestTelemetry: Map<string, RobotTelemetry>;
  aggregations: Map<string, TelemetryAggregation>;
  alerts: Map<string, TelemetryAlert>;
  settings: {
    retentionPeriod: number; // hours
    aggregationInterval: number; // minutes
    maxDataPoints: number;
    enableRealTimeProcessing: boolean;
    alertThresholds: {
      batteryLow: number;
      batteryCritical: number;
      temperatureHigh: number;
      cpuHigh: number;
      memoryHigh: number;
      latencyHigh: number;
      signalLow: number;
    };
  };
  processingCallbacks: Set<(telemetry: RobotTelemetry) => void>;
}

export interface TelemetryActions {
  // Data Management
  addTelemetry: (telemetry: RobotTelemetry) => void;
  getLatestTelemetry: (robotId: string) => RobotTelemetry | null;
  getTelemetryHistory: (
    robotId: string,
    timeRange?: { start: Date; end: Date }
  ) => RobotTelemetry[];
  clearTelemetry: (robotId?: string) => void;

  // Aggregations
  calculateAggregation: (
    robotId: string,
    timeRange: { start: Date; end: Date }
  ) => TelemetryAggregation;
  getAggregation: (robotId: string) => TelemetryAggregation | null;

  // Monitoring and Alerts
  processTelemetry: (telemetry: RobotTelemetry) => void;
  checkThresholds: (telemetry: RobotTelemetry) => Omit<TelemetryAlert, 'id' | 'timestamp'>[];
  createAlert: (alert: Omit<TelemetryAlert, 'id' | 'timestamp'>) => void;
  acknowledgeAlert: (alertId: string) => void;
  clearAlerts: (robotId?: string) => void;

  // Settings
  updateSettings: (settings: Partial<TelemetryState['settings']>) => void;
  addProcessingCallback: (callback: (telemetry: RobotTelemetry) => void) => () => void;

  // Analytics
  getRobotStats: (robotId: string) => {
    uptime: number;
    distanceTraveled: number;
    averageSpeed: number;
    batteryEfficiency: number;
    taskSuccessRate: number;
  } | null;
  getSystemStats: () => {
    totalRobots: number;
    activeRobots: number;
    averageBatteryLevel: number;
    alertsCount: number;
    dataPoints: number;
  };
}

export type TelemetryStore = TelemetryState & TelemetryActions;
