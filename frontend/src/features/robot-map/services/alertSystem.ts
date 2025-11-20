/**
 * Alert System Service
 * Real-time alert monitoring and management for robot telemetry and system events
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type {
  AlertFilters,
  AlertRule,
  AlertStats,
  AlertSystemState,
  AlertSystemStore,
  RobotAlert,
} from '../types/alerts';

const DEFAULT_SETTINGS: AlertSystemState['settings'] = {
  enableNotifications: true,
  enableSounds: true,
  autoAcknowledgeLowSeverity: false,
  maxAlertsHistory: 1000,
  alertRetentionDays: 30,
};

/**
 * Alert System Store
 * Zustand store for managing robot alerts and notifications
 */
export const useAlertSystemStore = create<AlertSystemStore>()(
  subscribeWithSelector((set, get) => ({
    alerts: new Map(),
    rules: new Map(),
    settings: DEFAULT_SETTINGS,
    notificationCallbacks: new Set(),

    createAlert: alertData => {
      const alert: RobotAlert = {
        ...alertData,
        id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
        acknowledged: false,
        resolved: false,
      };

      const state = get();

      const existingAlert = Array.from(state.alerts.values()).find(
        existing =>
          existing.robotId === alert.robotId &&
          existing.type === alert.type &&
          existing.category === alert.category &&
          !existing.resolved &&
          Date.now() - existing.timestamp.getTime() < 60000 // 1 minute cooldown
      );

      if (existingAlert) {
        return existingAlert; // Return existing alert instead of creating duplicate
      }

      const newAlerts = new Map(state.alerts);
      newAlerts.set(alert.id, alert);

      if (newAlerts.size > state.settings.maxAlertsHistory) {
        const sortedAlerts = Array.from(newAlerts.entries()).sort(
          ([, a], [, b]) => a.timestamp.getTime() - b.timestamp.getTime()
        );

        const toRemove = sortedAlerts.slice(0, newAlerts.size - state.settings.maxAlertsHistory);
        toRemove.forEach(([id]) => {
          newAlerts.delete(id);
        });
      }

      set({ alerts: newAlerts });

      if (state.settings.autoAcknowledgeLowSeverity && alert.severity === 'low') {
        get().acknowledgeAlert(alert.id, 'system');
      }

      get().evaluateRules(alert);

      if (state.settings.enableNotifications) {
        get().triggerNotification(alert);
      }

      return alert;
    },

    acknowledgeAlert: (alertId, acknowledgedBy) => {
      const state = get();
      const alert = state.alerts.get(alertId);

      if (alert && !alert.acknowledged) {
        const newAlerts = new Map(state.alerts);
        const updatedAlert: RobotAlert = {
          ...alert,
          acknowledged: true,
          acknowledgedAt: new Date(),
        };
        if (acknowledgedBy) {
          updatedAlert.acknowledgedBy = acknowledgedBy;
        }
        newAlerts.set(alertId, updatedAlert);
        set({ alerts: newAlerts });
      }
    },

    resolveAlert: (alertId, resolvedBy) => {
      const state = get();
      const alert = state.alerts.get(alertId);

      if (alert && !alert.resolved) {
        const newAlerts = new Map(state.alerts);
        const updatedAlert: RobotAlert = {
          ...alert,
          resolved: true,
          resolvedAt: new Date(),
        };
        if (resolvedBy) {
          updatedAlert.resolvedBy = resolvedBy;
        }
        newAlerts.set(alertId, updatedAlert);
        set({ alerts: newAlerts });
      }
    },

    updateAlert: (alertId, updates) => {
      const state = get();
      const alert = state.alerts.get(alertId);

      if (alert) {
        const newAlerts = new Map(state.alerts);
        newAlerts.set(alertId, { ...alert, ...updates });
        set({ alerts: newAlerts });
      }
    },

    deleteAlert: alertId => {
      const state = get();
      const newAlerts = new Map(state.alerts);
      newAlerts.delete(alertId);
      set({ alerts: newAlerts });
    },

    clearAcknowledgedAlerts: () => {
      const state = get();
      const newAlerts = new Map<string, RobotAlert>();
      state.alerts.forEach((alert, id) => {
        if (!alert.acknowledged) {
          newAlerts.set(id, alert);
        }
      });
      set({ alerts: newAlerts });
    },

    clearResolvedAlerts: () => {
      const state = get();
      const newAlerts = new Map<string, RobotAlert>();
      state.alerts.forEach((alert, id) => {
        if (!alert.resolved) {
          newAlerts.set(id, alert);
        }
      });
      set({ alerts: newAlerts });
    },

    clearOldAlerts: (daysOld = 7) => {
      const state = get();
      const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
      const newAlerts = new Map<string, RobotAlert>();

      state.alerts.forEach((alert, id) => {
        if (alert.timestamp.getTime() > cutoff) {
          newAlerts.set(id, alert);
        }
      });

      set({ alerts: newAlerts });
    },

    createRule: ruleData => {
      const rule: AlertRule = {
        ...ruleData,
        id: `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      };

      const state = get();
      const newRules = new Map(state.rules);
      newRules.set(rule.id, rule);
      set({ rules: newRules });

      return rule;
    },

    updateRule: (ruleId, updates) => {
      const state = get();
      const rule = state.rules.get(ruleId);

      if (rule) {
        const newRules = new Map(state.rules);
        newRules.set(ruleId, { ...rule, ...updates });
        set({ rules: newRules });
      }
    },

    deleteRule: ruleId => {
      const state = get();
      const newRules = new Map(state.rules);
      newRules.delete(ruleId);
      set({ rules: newRules });
    },

    enableRule: (ruleId, enabled) => {
      get().updateRule(ruleId, { enabled });
    },

    evaluateRules: alert => {
      const state = get();
      const matchingRules = Array.from(state.rules.values()).filter(
        rule =>
          rule.enabled &&
          (!rule.conditions.robotIds || rule.conditions.robotIds.includes(alert.robotId)) &&
          (!rule.conditions.type || rule.conditions.type === alert.type) &&
          (!rule.conditions.severity || rule.conditions.severity === alert.severity) &&
          (!rule.conditions.category || rule.conditions.category === alert.category) &&
          (!rule.lastTriggered || Date.now() - rule.lastTriggered.getTime() > rule.cooldownPeriod)
      );

      matchingRules.forEach(rule => {
        get().updateRule(rule.id, { lastTriggered: new Date() });

        if (rule.actions.notification) {
        }

        if (rule.actions.escalate && alert.severity === 'critical') {
        }

        if (rule.actions.autoResolve && alert.type === 'success') {
          get().resolveAlert(alert.id, 'system');
        }

        rule.actions.customActions?.forEach(action => {
          try {
            action.handler(alert);
          } catch (error) {
            console.error(`Error executing custom action '${action.name}':`, error);
          }
        });
      });
    },

    getAlerts: filters => {
      const state = get();
      let alerts = Array.from(state.alerts.values());

      if (filters) {
        alerts = alerts.filter(alert => matchesFilters(alert, filters));
      }

      return alerts.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    },

    getAlertStats: () => {
      const state = get();
      const alerts = Array.from(state.alerts.values());

      const stats: AlertStats = {
        total: alerts.length,
        unacknowledged: alerts.filter(a => !a.acknowledged).length,
        unresolved: alerts.filter(a => !a.resolved).length,
        byType: { error: 0, warning: 0, info: 0, success: 0 },
        bySeverity: { low: 0, medium: 0, high: 0, critical: 0 },
        byCategory: { connectivity: 0, battery: 0, navigation: 0, sensor: 0, system: 0, safety: 0 },
        recentTrend: {
          lastHour: 0,
          last24Hours: 0,
          lastWeek: 0,
        },
      };

      const now = Date.now();
      const hourAgo = now - 60 * 60 * 1000;
      const dayAgo = now - 24 * 60 * 60 * 1000;
      const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

      alerts.forEach(alert => {
        stats.byType[alert.type]++;
        stats.bySeverity[alert.severity]++;
        stats.byCategory[alert.category]++;

        const alertTime = alert.timestamp.getTime();
        if (alertTime > hourAgo) stats.recentTrend.lastHour++;
        if (alertTime > dayAgo) stats.recentTrend.last24Hours++;
        if (alertTime > weekAgo) stats.recentTrend.lastWeek++;
      });

      return stats;
    },

    getUnacknowledgedAlerts: () => {
      const state = get();
      return Array.from(state.alerts.values())
        .filter(alert => !alert.acknowledged)
        .sort((a, b) => {
          const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
          const aSeverity = severityOrder[a.severity];
          const bSeverity = severityOrder[b.severity];

          if (aSeverity !== bSeverity) {
            return bSeverity - aSeverity;
          }

          return b.timestamp.getTime() - a.timestamp.getTime();
        });
    },

    getCriticalAlerts: () => {
      const state = get();
      return Array.from(state.alerts.values())
        .filter(alert => alert.severity === 'critical' && !alert.resolved)
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    },

    getRobotAlerts: robotId => {
      const state = get();
      return Array.from(state.alerts.values())
        .filter(alert => alert.robotId === robotId)
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    },

    updateSettings: settings => {
      set(state => ({
        settings: { ...state.settings, ...settings },
      }));
    },

    addNotificationCallback: callback => {
      const state = get();
      const newCallbacks = new Set(state.notificationCallbacks);
      newCallbacks.add(callback);
      set({ notificationCallbacks: newCallbacks });

      return () => {
        set(currentState => {
          const currentCallbacks = new Set(currentState.notificationCallbacks);
          currentCallbacks.delete(callback);
          return { notificationCallbacks: currentCallbacks };
        });
      };
    },

    triggerNotification: alert => {
      const state = get();

      state.notificationCallbacks.forEach(callback => {
        try {
          callback(alert);
        } catch (error) {
          console.error('Error in notification callback:', error);
        }
      });

      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(`Robot Alert: ${alert.title}`, {
          body: alert.message,
          icon: '/favicon.ico',
          tag: alert.id,
          requireInteraction: alert.severity === 'critical',
        });
      }

      if (state.settings.enableSounds) {
        const playAlertSound = (severity: RobotAlert['severity']) => {
          try {
            const audio = new Audio();
            switch (severity) {
              case 'critical':
                audio.src = '/sounds/critical-alert.mp3';
                break;
              case 'high':
                audio.src = '/sounds/high-alert.mp3';
                break;
              default:
                audio.src = '/sounds/standard-alert.mp3';
            }
            audio.volume = 0.3;
            audio.play().catch(() => {
              // Ignore audio play errors (common in browsers)
            });
          } catch (_error) {
            // Ignore audio errors
          }
        };

        playAlertSound(alert.severity);
      }
    },
  }))
);

/**
 * Alert Manager Class
 * High-level interface for managing robot alerts
 */
export class AlertManager {
  private store = useAlertSystemStore.getState();

  /**
   * Create common alert types
   */
  createConnectivityAlert(robotId: string, status: 'connected' | 'disconnected'): RobotAlert {
    return this.store.createAlert({
      robotId,
      type: status === 'connected' ? 'success' : 'error',
      severity: status === 'connected' ? 'low' : 'high',
      title: status === 'connected' ? 'Robot Connected' : 'Robot Disconnected',
      message: `Robot ${robotId} has ${status} to the system`,
      category: 'connectivity',
      source: 'system',
    });
  }

  createBatteryAlert(robotId: string, batteryLevel: number): RobotAlert | null {
    if (batteryLevel <= 10) {
      return this.store.createAlert({
        robotId,
        type: 'error',
        severity: 'critical',
        title: 'Critical Battery Level',
        message: `Robot ${robotId} battery level: ${batteryLevel.toFixed(1)}%`,
        category: 'battery',
        source: 'robot',
        data: { batteryLevel },
      });
    } else if (batteryLevel <= 20) {
      return this.store.createAlert({
        robotId,
        type: 'warning',
        severity: 'medium',
        title: 'Low Battery',
        message: `Robot ${robotId} battery level: ${batteryLevel.toFixed(1)}%`,
        category: 'battery',
        source: 'robot',
        data: { batteryLevel },
      });
    }
    return null;
  }

  createNavigationAlert(
    robotId: string,
    issue: string,
    severity: RobotAlert['severity'] = 'medium'
  ): RobotAlert {
    return this.store.createAlert({
      robotId,
      type: 'warning',
      severity,
      title: 'Navigation Issue',
      message: `Robot ${robotId}: ${issue}`,
      category: 'navigation',
      source: 'robot',
    });
  }

  createSensorAlert(robotId: string, sensor: string, issue: string): RobotAlert {
    return this.store.createAlert({
      robotId,
      type: 'warning',
      severity: 'medium',
      title: 'Sensor Issue',
      message: `Robot ${robotId} ${sensor}: ${issue}`,
      category: 'sensor',
      source: 'robot',
    });
  }

  createSafetyAlert(
    robotId: string,
    issue: string,
    severity: RobotAlert['severity'] = 'high'
  ): RobotAlert {
    return this.store.createAlert({
      robotId,
      type: 'error',
      severity,
      title: 'Safety Alert',
      message: `Robot ${robotId}: ${issue}`,
      category: 'safety',
      source: 'robot',
    });
  }

  createSystemAlert(
    robotId: string,
    title: string,
    message: string,
    type: RobotAlert['type'] = 'info'
  ): RobotAlert {
    return this.store.createAlert({
      robotId,
      type,
      severity: 'low',
      title,
      message,
      category: 'system',
      source: 'system',
    });
  }

  /**
   * Setup default alert rules
   */
  setupDefaultRules(): void {
    const { createRule } = this.store;

    createRule({
      name: 'Critical Alerts Escalation',
      enabled: true,
      conditions: {
        severity: 'critical',
      },
      actions: {
        notification: true,
        escalate: true,
      },
      cooldownPeriod: 30000, // 30 seconds
    });

    createRule({
      name: 'Low Battery Monitoring',
      enabled: true,
      conditions: {
        category: 'battery',
        severity: 'critical',
      },
      actions: {
        notification: true,
      },
      cooldownPeriod: 60000, // 1 minute
    });

    createRule({
      name: 'Navigation Failures',
      enabled: true,
      conditions: {
        category: 'navigation',
        severity: 'high',
      },
      actions: {
        notification: true,
      },
      cooldownPeriod: 120000, // 2 minutes
    });
  }

  /**
   * Request notification permissions
   */
  async requestNotificationPermissions(): Promise<boolean> {
    if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    }
    return false;
  }

  /**
   * Export alerts to JSON
   */
  exportAlerts(filters?: Parameters<AlertSystemStore['getAlerts']>[0]): string {
    const alerts = this.store.getAlerts(filters);
    return JSON.stringify(alerts, null, 2);
  }

  /**
   * Get alert statistics
   */
  getStats(): AlertStats {
    return this.store.getAlertStats();
  }
}

/**
 * Global alert manager instance
 */
export const alertManager = new AlertManager();

/**
 * Hook for accessing alert system
 */
export function useAlertSystem() {
  const store = useAlertSystemStore();

  return {
    // Alert management
    createAlert: store.createAlert,
    acknowledgeAlert: store.acknowledgeAlert,
    resolveAlert: store.resolveAlert,
    updateAlert: store.updateAlert,
    deleteAlert: store.deleteAlert,
    clearAcknowledgedAlerts: store.clearAcknowledgedAlerts,
    clearResolvedAlerts: store.clearResolvedAlerts,
    clearOldAlerts: store.clearOldAlerts,

    // Queries
    getAlerts: store.getAlerts,
    getAlertStats: store.getAlertStats,
    getUnacknowledgedAlerts: store.getUnacknowledgedAlerts,
    getCriticalAlerts: store.getCriticalAlerts,
    getRobotAlerts: store.getRobotAlerts,

    // Settings
    updateSettings: store.updateSettings,
    addNotificationCallback: store.addNotificationCallback,

    settings: store.settings,
  };
}

/**
 * Check if alert matches filters
 */
function matchesFilters(alert: RobotAlert, filters: AlertFilters): boolean {
  if (filters.robotId && alert.robotId !== filters.robotId) return false;
  if (filters.type && alert.type !== filters.type) return false;
  if (filters.severity && alert.severity !== filters.severity) return false;
  if (filters.category && alert.category !== filters.category) return false;
  if (filters.acknowledged !== undefined && alert.acknowledged !== filters.acknowledged)
    return false;
  if (filters.resolved !== undefined && alert.resolved !== filters.resolved) return false;

  if (filters.timeRange && !matchesTimeRange(alert.timestamp, filters.timeRange)) {
    return false;
  }

  return true;
}

function matchesTimeRange(timestamp: Date, range: { start: Date; end: Date }): boolean {
  const time = timestamp.getTime();
  return time >= range.start.getTime() && time <= range.end.getTime();
}
