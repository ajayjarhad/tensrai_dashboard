export interface AuditLog {
  id: string;
  userId: string;
  role: string;
  action: AuditAction;
  timestamp: Date;
  metadata?: AuditMetadata;
}

export type AuditAction =
  | 'USER_CREATED'
  | 'USER_UPDATED'
  | 'USER_DELETED'
  | 'USER_ACTIVATED'
  | 'USER_DEACTIVATED'
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'PASSWORD_CHANGED'
  | 'PASSWORD_RESET'
  | 'TEMP_PASSWORD_CREATED'
  | 'TEMP_PASSWORD_USED'
  | 'ROLE_CHANGED'
  | 'PERMISSION_GRANTED'
  | 'PERMISSION_REVOKED'
  | 'SYSTEM_ACCESS_DENIED'
  | 'UNAUTHORIZED_ATTEMPT';

export interface AuditMetadata {
  ipAddress?: string;
  userAgent?: string;
  targetUserId?: string;
  oldRole?: string;
  newRole?: string;
  permission?: string;
  reason?: string;
  context?: Record<string, unknown>;
}

export interface AuditQuery {
  userId?: string;
  action?: AuditAction;
  startDate?: Date;
  endDate?: Date;
  role?: string;
  limit?: number;
  offset?: number;
}

export interface AuditEvent {
  userId: string;
  role: string;
  action: AuditAction;
  metadata?: AuditMetadata;
}

export interface AuditSummary {
  totalEvents: number;
  eventTypes: Record<AuditAction, number>;
  usersByActivity: Array<{
    userId: string;
    username: string;
    eventCount: number;
    lastActivity: Date;
  }>;
  securityEvents: number;
}
