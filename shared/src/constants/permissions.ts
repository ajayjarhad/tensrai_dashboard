export const ROLE = {
  ADMIN: 'ADMIN',
  USER: 'USER' as const,
  STAFF: 'STAFF',
} as const;

export const PERMISSIONS = {
  USER_MANAGEMENT: 'admin:user_management',
  SYSTEM_CONFIG: 'admin:system_config',
  DASHBOARD_VIEW: 'user:dashboard_view',
  ROBOT_STATUS_READ: 'user:robot_status_read',
  ROBOT_CONTROL: 'robot:control',
  EMERGENCY_STOP: 'robot:emergency_stop',
  STAFF_CONSOLE: 'staff:console',
  MAPS_VIEW: 'maps:view',
  MAPS_EDIT: 'maps:edit',
  MAPS_SYNC: 'maps:sync',
  MAPS_DELETE: 'maps:delete',
} as const;

// Anyone in the organization that owns a robot may operate it, and edit and sync its maps.
// Admins also manage the organization's users, robot records and map deletion; staff work across
// organizations.
const ROBOT_OPERATION_PERMISSIONS = [
  PERMISSIONS.DASHBOARD_VIEW,
  PERMISSIONS.ROBOT_STATUS_READ,
  PERMISSIONS.ROBOT_CONTROL,
  PERMISSIONS.EMERGENCY_STOP,
  PERMISSIONS.MAPS_VIEW,
  PERMISSIONS.MAPS_EDIT,
  PERMISSIONS.MAPS_SYNC,
] as const;

export const ROLE_PERMISSIONS = {
  [ROLE.ADMIN]: [
    ...ROBOT_OPERATION_PERMISSIONS,
    PERMISSIONS.USER_MANAGEMENT,
    PERMISSIONS.SYSTEM_CONFIG,
    PERMISSIONS.MAPS_DELETE,
  ],
  [ROLE.USER]: ROBOT_OPERATION_PERMISSIONS,
  [ROLE.STAFF]: Object.values(PERMISSIONS),
} as const;

export type Role = (typeof ROLE)[keyof typeof ROLE];
export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
