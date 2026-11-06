import {
  type Attributes,
  type AttributeValue,
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

const tracer = trace.getTracer('tensrai-auth', '1.0.0');

/**
 * Trace an authentication attempt
 */
const traceAuthAttempt = (
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
const traceUserManagement = (
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

export const AuthTracer = {
  traceAuthAttempt,
  traceUserManagement,
};
