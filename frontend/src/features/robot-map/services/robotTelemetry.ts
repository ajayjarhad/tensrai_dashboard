/**
 * Robot Telemetry Service
 * Handles collection, processing, and storage of robot telemetry data
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type {
  RobotTelemetry,
  TelemetryAggregation,
  TelemetryAlert,
  TelemetryState,
  TelemetryStore,
} from '../types/telemetry';
import { alertManager } from './alertSystem';

const DEFAULT_SETTINGS: TelemetryState['settings'] = {
  retentionPeriod: 24, // hours
  aggregationInterval: 5, // minutes
  maxDataPoints: 10000,
  enableRealTimeProcessing: true,
  alertThresholds: {
    batteryLow: 20,
    batteryCritical: 10,
    temperatureHigh: 70,
    cpuHigh: 80,
    memoryHigh: 85,
    latencyHigh: 1000,
    signalLow: -70,
  },
};

/**
 * Helper: Check battery thresholds
 */
function checkBatteryThresholds(
  telemetry: RobotTelemetry,
  state: TelemetryState,
  alerts: Omit<TelemetryAlert, 'id' | 'timestamp'>[]
): void {
  if (telemetry.battery.level <= state.settings.alertThresholds.batteryCritical) {
    alerts.push({
      robotId: telemetry.robotId,
      type: 'threshold',
      metric: 'battery',
      value: telemetry.battery.level,
      threshold: state.settings.alertThresholds.batteryCritical,
      message: `Critical battery level: ${telemetry.battery.level.toFixed(1)}%`,
      severity: 'critical',
      acknowledged: false,
    });
  } else if (telemetry.battery.level <= state.settings.alertThresholds.batteryLow) {
    alerts.push({
      robotId: telemetry.robotId,
      type: 'threshold',
      metric: 'battery',
      value: telemetry.battery.level,
      threshold: state.settings.alertThresholds.batteryLow,
      message: `Low battery level: ${telemetry.battery.level.toFixed(1)}%`,
      severity: 'medium',
      acknowledged: false,
    });
  }
}

/**
 * Helper: Check system thresholds (CPU, memory, temperature)
 */
function checkSystemThresholds(
  telemetry: RobotTelemetry,
  state: TelemetryState,
  alerts: Omit<TelemetryAlert, 'id' | 'timestamp'>[]
): void {
  if (telemetry.system.temperature >= state.settings.alertThresholds.temperatureHigh) {
    alerts.push({
      robotId: telemetry.robotId,
      type: 'threshold',
      metric: 'temperature',
      value: telemetry.system.temperature,
      threshold: state.settings.alertThresholds.temperatureHigh,
      message: `High temperature: ${telemetry.system.temperature.toFixed(1)}°C`,
      severity: 'high',
      acknowledged: false,
    });
  }

  if (telemetry.system.cpuUsage >= state.settings.alertThresholds.cpuHigh) {
    alerts.push({
      robotId: telemetry.robotId,
      type: 'threshold',
      metric: 'cpu',
      value: telemetry.system.cpuUsage,
      threshold: state.settings.alertThresholds.cpuHigh,
      message: `High CPU usage: ${telemetry.system.cpuUsage.toFixed(1)}%`,
      severity: 'medium',
      acknowledged: false,
    });
  }

  if (telemetry.system.memoryUsage >= state.settings.alertThresholds.memoryHigh) {
    alerts.push({
      robotId: telemetry.robotId,
      type: 'threshold',
      metric: 'memory',
      value: telemetry.system.memoryUsage,
      threshold: state.settings.alertThresholds.memoryHigh,
      message: `High memory usage: ${telemetry.system.memoryUsage.toFixed(1)}%`,
      severity: 'medium',
      acknowledged: false,
    });
  }
}

/**
 * Helper: Check connectivity thresholds
 */
function checkConnectivityThresholds(
  telemetry: RobotTelemetry,
  state: TelemetryState,
  alerts: Omit<TelemetryAlert, 'id' | 'timestamp'>[]
): void {
  if (telemetry.connectivity.latency >= state.settings.alertThresholds.latencyHigh) {
    alerts.push({
      robotId: telemetry.robotId,
      type: 'threshold',
      metric: 'latency',
      value: telemetry.connectivity.latency,
      threshold: state.settings.alertThresholds.latencyHigh,
      message: `High latency: ${telemetry.connectivity.latency.toFixed(0)}ms`,
      severity: 'medium',
      acknowledged: false,
    });
  }

  if (telemetry.connectivity.wifiSignal <= state.settings.alertThresholds.signalLow) {
    alerts.push({
      robotId: telemetry.robotId,
      type: 'threshold',
      metric: 'wifi_signal',
      value: telemetry.connectivity.wifiSignal,
      threshold: state.settings.alertThresholds.signalLow,
      message: `Poor Wi-Fi signal: ${telemetry.connectivity.wifiSignal} dBm`,
      severity: 'medium',
      acknowledged: false,
    });
  }
}

/**
 * Helper: Check navigation state
 */
function checkNavigationState(
  telemetry: RobotTelemetry,
  alerts: Omit<TelemetryAlert, 'id' | 'timestamp'>[]
): void {
  if (telemetry.navigation.state === 'stuck') {
    alerts.push({
      robotId: telemetry.robotId,
      type: 'anomaly',
      metric: 'navigation_state',
      value: 1,
      message: 'Robot is stuck and needs assistance',
      severity: 'high',
      acknowledged: false,
    });
  }
}

/**
 * Telemetry Store
 * Zustand store for managing robot telemetry data
 */
export const useTelemetryStore = create<TelemetryStore>()(
  subscribeWithSelector((set, get) => ({
    telemetry: new Map(),
    latestTelemetry: new Map(),
    aggregations: new Map(),
    alerts: new Map(),
    settings: DEFAULT_SETTINGS,
    processingCallbacks: new Set(),

    // Data Management
    addTelemetry: telemetryData => {
      const state = get();
      const robotTelemetry = state.telemetry.get(telemetryData.robotId) || [];

      // Add new data point
      robotTelemetry.push(telemetryData);

      // Update latest telemetry
      const newLatestTelemetry = new Map(state.latestTelemetry);
      newLatestTelemetry.set(telemetryData.robotId, telemetryData);

      // Apply retention policy
      const retentionCutoff = new Date(
        Date.now() - state.settings.retentionPeriod * 60 * 60 * 1000
      );
      const filteredTelemetry = robotTelemetry.filter(t => t.timestamp > retentionCutoff);

      // Apply max data points limit
      if (filteredTelemetry.length > state.settings.maxDataPoints) {
        filteredTelemetry.splice(0, filteredTelemetry.length - state.settings.maxDataPoints);
      }

      const updatedTelemetry = new Map(state.telemetry);
      updatedTelemetry.set(telemetryData.robotId, filteredTelemetry);

      set({
        telemetry: updatedTelemetry,
        latestTelemetry: newLatestTelemetry,
      });

      // Process telemetry if enabled
      if (state.settings.enableRealTimeProcessing) {
        get().processTelemetry(telemetryData);
      }
    },

    getLatestTelemetry: robotId => {
      return get().latestTelemetry.get(robotId) || null;
    },

    getTelemetryHistory: (robotId, timeRange) => {
      const state = get();
      const telemetry = state.telemetry.get(robotId) || [];

      if (!timeRange) {
        return telemetry;
      }

      return telemetry.filter(t => t.timestamp >= timeRange.start && t.timestamp <= timeRange.end);
    },

    clearTelemetry: robotId => {
      const state = get();

      if (robotId) {
        const newTelemetry = new Map(state.telemetry);
        newTelemetry.delete(robotId);

        const newLatestTelemetry = new Map(state.latestTelemetry);
        newLatestTelemetry.delete(robotId);

        const newAggregations = new Map(state.aggregations);
        newAggregations.delete(robotId);

        set({
          telemetry: newTelemetry,
          latestTelemetry: newLatestTelemetry,
          aggregations: newAggregations,
        });
      } else {
        // Clear all telemetry
        set({
          telemetry: new Map(),
          latestTelemetry: new Map(),
          aggregations: new Map(),
        });
      }
    },

    // Aggregations
    calculateAggregation: (robotId, timeRange) => {
      const state = get();
      const telemetry = get().getTelemetryHistory(robotId, timeRange);

      if (telemetry.length === 0) {
        return {
          robotId,
          timeRange,
          samples: 0,
          pose: { distanceTraveled: 0, averageSpeed: 0, maxSpeed: 0, totalRotations: 0 },
          battery: { averageLevel: 0, minLevel: 0, maxLevel: 0, dischargeRate: 0 },
          navigation: { successRate: 0, averagePathLength: 0, averageTimeToGoal: 0, stuckCount: 0 },
          system: {
            averageCpuUsage: 0,
            peakCpuUsage: 0,
            averageMemoryUsage: 0,
            peakMemoryUsage: 0,
            averageTemperature: 0,
            maxTemperature: 0,
          },
        };
      }

      // Calculate pose metrics
      let distanceTraveled = 0;
      let maxSpeed = 0;
      const speeds: number[] = [];

      for (let i = 1; i < telemetry.length; i++) {
        const prev = telemetry[i - 1];
        const curr = telemetry[i];

        const dx = curr.pose.pose.position.x - prev.pose.pose.position.x;
        const dy = curr.pose.pose.position.y - prev.pose.pose.position.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        distanceTraveled += distance;

        const timeDiff = (curr.timestamp.getTime() - prev.timestamp.getTime()) / 1000;
        if (timeDiff > 0) {
          const speed = distance / timeDiff;
          speeds.push(speed);
          maxSpeed = Math.max(maxSpeed, speed);
        }
      }

      const averageSpeed =
        speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;

      // Calculate battery metrics
      const batteryLevels = telemetry.map(t => t.battery.level);
      const averageBattery = batteryLevels.reduce((a, b) => a + b, 0) / batteryLevels.length;
      const minBattery = Math.min(...batteryLevels);
      const maxBattery = Math.max(...batteryLevels);

      const timeSpanHours =
        (timeRange.end.getTime() - timeRange.start.getTime()) / (1000 * 60 * 60);
      const dischargeRate = timeSpanHours > 0 ? (maxBattery - minBattery) / timeSpanHours : 0;

      // Calculate system metrics
      const cpuUsages = telemetry.map(t => t.system.cpuUsage);
      const memoryUsages = telemetry.map(t => t.system.memoryUsage);
      const temperatures = telemetry.map(t => t.system.temperature);

      const aggregation: TelemetryAggregation = {
        robotId,
        timeRange,
        samples: telemetry.length,
        pose: {
          distanceTraveled,
          averageSpeed,
          maxSpeed,
          totalRotations: 0, // Would need quaternion calculations
        },
        battery: {
          averageLevel: averageBattery,
          minLevel: minBattery,
          maxLevel: maxBattery,
          dischargeRate,
        },
        navigation: {
          successRate: 0, // Would need goal tracking
          averagePathLength: 0,
          averageTimeToGoal: 0,
          stuckCount: telemetry.filter(t => t.navigation.state === 'stuck').length,
        },
        system: {
          averageCpuUsage: cpuUsages.reduce((a, b) => a + b, 0) / cpuUsages.length,
          peakCpuUsage: Math.max(...cpuUsages),
          averageMemoryUsage: memoryUsages.reduce((a, b) => a + b, 0) / memoryUsages.length,
          peakMemoryUsage: Math.max(...memoryUsages),
          averageTemperature: temperatures.reduce((a, b) => a + b, 0) / temperatures.length,
          maxTemperature: Math.max(...temperatures),
        },
      };

      // Store aggregation
      const newAggregations = new Map(state.aggregations);
      newAggregations.set(robotId, aggregation);
      set({ aggregations: newAggregations });

      return aggregation;
    },

    getAggregation: robotId => {
      return get().aggregations.get(robotId) || null;
    },

    // Monitoring and Alerts
    processTelemetry: telemetry => {
      const state = get();

      // Check thresholds and create alerts
      const alerts = get().checkThresholds(telemetry);
      alerts.forEach(alert => {
        get().createAlert(alert);
      });

      // Call processing callbacks
      state.processingCallbacks.forEach(callback => {
        try {
          callback(telemetry);
        } catch (error) {
          console.error('Error in telemetry processing callback:', error);
        }
      });
    },

    checkThresholds: telemetry => {
      const state = get();
      const alerts: Omit<TelemetryAlert, 'id' | 'timestamp'>[] = [];

      // Check all thresholds using helper functions
      checkBatteryThresholds(telemetry, state, alerts);
      checkSystemThresholds(telemetry, state, alerts);
      checkConnectivityThresholds(telemetry, state, alerts);
      checkNavigationState(telemetry, alerts);

      return alerts;
    },

    createAlert: alertData => {
      const alert: TelemetryAlert = {
        ...alertData,
        id: `telemetry_alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
      };

      const state = get();
      const newAlerts = new Map(state.alerts);
      newAlerts.set(alert.id, alert);
      set({ alerts: newAlerts });

      // Forward to main alert system
      alertManager.createSystemAlert(
        alert.robotId,
        'Telemetry Alert',
        alert.message,
        alert.severity === 'critical' ? 'error' : 'warning'
      );
    },

    acknowledgeAlert: alertId => {
      const state = get();
      const alert = state.alerts.get(alertId);

      if (alert) {
        const newAlerts = new Map(state.alerts);
        newAlerts.set(alertId, { ...alert, acknowledged: true });
        set({ alerts: newAlerts });
      }
    },

    clearAlerts: robotId => {
      const state = get();
      const newAlerts = new Map<string, TelemetryAlert>();

      state.alerts.forEach((alert, id) => {
        if (!robotId || alert.robotId !== robotId) {
          newAlerts.set(id, alert);
        }
      });

      set({ alerts: newAlerts });
    },

    // Settings
    updateSettings: settings => {
      set(state => ({
        settings: { ...state.settings, ...settings },
      }));
    },

    addProcessingCallback: callback => {
      const state = get();
      const newCallbacks = new Set(state.processingCallbacks);
      newCallbacks.add(callback);
      set({ processingCallbacks: newCallbacks });

      return () => {
        set(currentState => {
          const currentCallbacks = new Set(currentState.processingCallbacks);
          currentCallbacks.delete(callback);
          return { processingCallbacks: currentCallbacks };
        });
      };
    },

    // Analytics
    getRobotStats: robotId => {
      const state = get();
      const latest = state.latestTelemetry.get(robotId);
      const aggregation = state.aggregations.get(robotId);

      if (!latest || !aggregation) {
        return null;
      }

      const uptime = latest.system.uptime;
      const distanceTraveled = aggregation.pose.distanceTraveled;
      const averageSpeed = aggregation.pose.averageSpeed;
      const batteryEfficiency =
        aggregation.battery.dischargeRate > 0
          ? distanceTraveled / aggregation.battery.dischargeRate
          : 0;

      // Calculate task success rate
      const totalTasks = latest.tasks.tasksCompleted + latest.tasks.tasksFailed;
      const taskSuccessRate = totalTasks > 0 ? (latest.tasks.tasksCompleted / totalTasks) * 100 : 0;

      return {
        uptime,
        distanceTraveled,
        averageSpeed,
        batteryEfficiency,
        taskSuccessRate,
      };
    },

    getSystemStats: () => {
      const state = get();
      const robots = Array.from(state.latestTelemetry.values());

      const totalRobots = robots.length;
      const activeRobots = robots.filter(
        r => Date.now() - r.timestamp.getTime() < 60000 // Active in last minute
      ).length;

      const averageBatteryLevel =
        robots.length > 0 ? robots.reduce((sum, r) => sum + r.battery.level, 0) / robots.length : 0;

      const alertsCount = state.alerts.size;
      const dataPoints = Array.from(state.telemetry.values()).reduce(
        (sum, arr) => sum + arr.length,
        0
      );

      return {
        totalRobots,
        activeRobots,
        averageBatteryLevel,
        alertsCount,
        dataPoints,
      };
    },
  }))
);

/**
 * Hook for accessing telemetry system
 */
export function useRobotTelemetry() {
  const store = useTelemetryStore();

  return {
    // Data management
    addTelemetry: store.addTelemetry,
    getLatestTelemetry: store.getLatestTelemetry,
    getTelemetryHistory: store.getTelemetryHistory,
    clearTelemetry: store.clearTelemetry,

    // Aggregations
    calculateAggregation: store.calculateAggregation,
    getAggregation: store.getAggregation,

    // Monitoring
    checkThresholds: store.checkThresholds,
    createAlert: store.createAlert,
    acknowledgeAlert: store.acknowledgeAlert,
    clearAlerts: store.clearAlerts,

    // Analytics
    getRobotStats: store.getRobotStats,
    getSystemStats: store.getSystemStats,

    // Settings
    updateSettings: store.updateSettings,
    addProcessingCallback: store.addProcessingCallback,

    // State
    telemetry: store.telemetry,
    latestTelemetry: store.latestTelemetry,
    alerts: store.alerts,
    settings: store.settings,
  };
}
