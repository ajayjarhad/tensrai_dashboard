export const ROLE = {
  ADMIN: 'ADMIN',
  USER: 'USER' as const,
} as const;

export const PERMISSIONS = {
  USER_MANAGEMENT: 'admin:user_management',
  SYSTEM_CONFIG: 'admin:system_config',
  DASHBOARD_VIEW: 'user:dashboard_view',
  ROBOT_STATUS_READ: 'user:robot_status_read',
  ROBOT_CONTROL: 'robot:control',
  EMERGENCY_STOP: 'robot:emergency_stop',
} as const;

export const ROLE_PERMISSIONS = {
  [ROLE.ADMIN]: Object.values(PERMISSIONS),
  [ROLE.USER]: [PERMISSIONS.DASHBOARD_VIEW, PERMISSIONS.ROBOT_STATUS_READ],
} as const;

export type Role = (typeof ROLE)[keyof typeof ROLE];
export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
