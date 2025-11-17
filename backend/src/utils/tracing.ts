import {
  type AttributeValue,
  type Attributes,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';

const normalizeValue = (value: unknown): AttributeValue => {
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return value;
    default:
      return JSON.stringify(value);
  }
};

const formatMetadata = (metadata?: Record<string, unknown>): Attributes | undefined => {
  if (!metadata) {
    return undefined;
  }

  const attributes: Attributes = {};
  for (const [key, value] of Object.entries(metadata)) {
    attributes[`auth.metadata.${key}`] = normalizeValue(value);
  }
  return attributes;
};

const toAttributes = (attributes: Record<string, unknown>): Attributes => {
  const normalized: Attributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    normalized[key] = normalizeValue(value);
  }
  return normalized;
};

const tracer = trace.getTracer('tensrai-auth', '1.0.0');

/**
 * Trace a permission check event
 */
export const tracePermissionCheck = (
  userId: string,
  role: string,
  permission: string,
  granted: boolean,
  metadata?: Record<string, unknown>
) => {
  return tracer.startActiveSpan('auth.permission.check', { kind: SpanKind.SERVER }, span => {
    try {
      span.setAttributes({
        'auth.user.id': userId,
        'auth.user.role': role,
        'auth.permission': permission,
        'auth.permission.granted': granted,
        'auth.event.type': 'permission_check',
      });

      const attributes = formatMetadata(metadata);
      if (attributes) {
        span.setAttributes(attributes);
      }

      span.addEvent('permission_checked', {
        userId,
        role,
        permission,
        granted,
      });

      if (granted) {
        span.setStatus({
          code: SpanStatusCode.OK,
          message: 'Permission granted',
        });
      } else {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: 'Permission denied',
        });
      }
    } finally {
      span.end();
    }
  });
};

/**
 * Trace an authentication attempt
 */
export const traceAuthAttempt = (
  userId: string,
  method: string,
  success?: boolean,
  error?: string,
  metadata?: Record<string, unknown>
) => {
  return tracer.startActiveSpan('auth.attempt', { kind: SpanKind.SERVER }, span => {
    try {
      span.setAttributes({
        'auth.user.id': userId,
        'auth.method': method,
        'auth.event.type': 'auth_attempt',
      });

      const attributes = formatMetadata(metadata);
      if (attributes) {
        span.setAttributes(attributes);
      }

      span.addEvent('authentication_attempted', {
        userId,
        method,
      });

      if (success !== undefined) {
        span.setAttribute('auth.success', success);
      }

      if (error) {
        span.setAttribute('auth.error', error);
      }

      if (success) {
        span.setStatus({
          code: SpanStatusCode.OK,
          message: 'Authentication successful',
        });
      } else if (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: `Authentication failed: ${error}`,
        });
      }
    } finally {
      span.end();
    }
  });
};

/**
 * Trace user management actions
 */
export const traceUserManagement = (
  action: string,
  adminUserId: string,
  targetUserId?: string,
  metadata?: Record<string, unknown>
) => {
  return tracer.startActiveSpan('auth.user.management', { kind: SpanKind.SERVER }, span => {
    try {
      span.setAttributes({
        'auth.admin.id': adminUserId,
        'auth.action': action,
        'auth.event.type': 'user_management',
      });

      if (targetUserId) {
        span.setAttribute('auth.target.user.id', targetUserId);
      }

      const attributes = formatMetadata(metadata);
      if (attributes) {
        span.setAttributes(attributes);
      }

      span.addEvent('user_management_action', {
        action,
        adminUserId,
        targetUserId,
      });

      span.setStatus({
        code: SpanStatusCode.OK,
        message: `User management action completed: ${action}`,
      });
    } finally {
      span.end();
    }
  });
};

/**
 * Trace emergency stop events
 */
export const traceEmergencyStop = (
  userId: string,
  reason: string,
  success: boolean,
  metadata?: Record<string, unknown>
) => {
  return tracer.startActiveSpan('auth.emergency.stop', { kind: SpanKind.SERVER }, span => {
    try {
      span.setAttributes({
        'auth.user.id': userId,
        'auth.emergency.reason': reason,
        'auth.emergency.success': success,
        'auth.event.type': 'emergency_stop',
        'auth.critical': true,
      });

      const attributes = formatMetadata(metadata);
      if (attributes) {
        span.setAttributes(attributes);
      }

      span.addEvent('emergency_stop_triggered', {
        userId,
        reason,
      });

      if (success) {
        span.setStatus({
          code: SpanStatusCode.OK,
          message: 'Emergency stop executed successfully',
        });
      } else {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: 'Emergency stop failed',
        });
      }

      span.addEvent('emergency_stop_executed', {
        userId,
        reason,
        success,
      });
    } finally {
      span.end();
    }
  });
};

/**
 * Helper function to get current active span
 */
export const getCurrentSpan = () => {
  return trace.getActiveSpan();
};

/**
 * Helper function to add attributes to current span
 */
export const addSpanAttributes = (attributes: Record<string, unknown>) => {
  const span = getCurrentSpan();
  if (span) {
    span.setAttributes(toAttributes(attributes));
  }
};

/**
 * Helper function to add event to current span
 */
export const addSpanEvent = (name: string, attributes?: Record<string, unknown>) => {
  const span = getCurrentSpan();
  if (span) {
    span.addEvent(name, attributes ? toAttributes(attributes) : undefined);
  }
};

/**
 * Legacy compatibility - export object with same methods as old class
 */
export const AuthTracer = {
  tracePermissionCheck,
  traceAuthAttempt,
  traceUserManagement,
  traceEmergencyStop,
};
