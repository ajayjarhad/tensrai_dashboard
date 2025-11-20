/**
 * Alert System Types
 * Type definitions for the robot alert and notification system
 */

export interface RobotAlert {
  id: string;
  robotId: string;
  type: 'error' | 'warning' | 'info' | 'success';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  message: string;
  timestamp: Date;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: Date;
  resolved: boolean;
  resolvedBy?: string;
  resolvedAt?: Date;
  data?: any;
  category: 'connectivity' | 'battery' | 'navigation' | 'sensor' | 'system' | 'safety';
  source: 'system' | 'robot' | 'user' | 'ros';
}

export interface AlertFilters {
  robotId?: string;
  type?: RobotAlert['type'];
  severity?: RobotAlert['severity'];
  category?: RobotAlert['category'];
  acknowledged?: boolean;
  resolved?: boolean;
  timeRange?: { start: Date; end: Date };
}

export interface AlertRule {
  id: string;
  name: string;
  enabled: boolean;
  conditions: {
    robotIds?: string[];
    type?: RobotAlert['type'];
    severity?: RobotAlert['severity'];
    category?: RobotAlert['category'];
  };
  actions: {
    notification: boolean;
    email?: boolean;
    escalate?: boolean;
    autoResolve?: boolean;
    customActions?: Array<{
      name: string;
      handler: (alert: RobotAlert) => void;
    }>;
  };
  cooldownPeriod: number;
  lastTriggered?: Date;
}

export interface AlertStats {
  total: number;
  unacknowledged: number;
  unresolved: number;
  byType: Record<RobotAlert['type'], number>;
  bySeverity: Record<RobotAlert['severity'], number>;
  byCategory: Record<RobotAlert['category'], number>;
  recentTrend: {
    lastHour: number;
    last24Hours: number;
    lastWeek: number;
  };
}

// Alert System State and Action Interfaces
export interface AlertSystemState {
  alerts: Map<string, RobotAlert>;
  rules: Map<string, AlertRule>;
  settings: {
    enableNotifications: boolean;
    enableSounds: boolean;
    autoAcknowledgeLowSeverity: boolean;
    maxAlertsHistory: number;
    alertRetentionDays: number;
  };
  notificationCallbacks: Set<(alert: RobotAlert) => void>;
}

export interface AlertSystemActions {
  createAlert: (
    alert: Omit<RobotAlert, 'id' | 'timestamp' | 'acknowledged' | 'resolved'>
  ) => RobotAlert;
  acknowledgeAlert: (alertId: string, acknowledgedBy?: string) => void;
  resolveAlert: (alertId: string, resolvedBy?: string) => void;
  updateAlert: (alertId: string, updates: Partial<RobotAlert>) => void;
  deleteAlert: (alertId: string) => void;
  clearAcknowledgedAlerts: () => void;
  clearResolvedAlerts: () => void;
  clearOldAlerts: (daysOld?: number) => void;

  createRule: (rule: Omit<AlertRule, 'id'>) => AlertRule;
  updateRule: (ruleId: string, updates: Partial<AlertRule>) => void;
  deleteRule: (ruleId: string) => void;
  enableRule: (ruleId: string, enabled: boolean) => void;
  evaluateRules: (alert: RobotAlert) => void;

  getAlerts: (filters?: AlertFilters) => RobotAlert[];
  getAlertStats: () => AlertStats;
  getUnacknowledgedAlerts: () => RobotAlert[];
  getCriticalAlerts: () => RobotAlert[];
  getRobotAlerts: (robotId: string) => RobotAlert[];

  updateSettings: (settings: Partial<AlertSystemState['settings']>) => void;
  addNotificationCallback: (callback: (alert: RobotAlert) => void) => () => void;
  triggerNotification: (alert: RobotAlert) => void;
}

export type AlertSystemStore = AlertSystemState & AlertSystemActions;
