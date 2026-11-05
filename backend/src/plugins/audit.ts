import type { Prisma } from '@prisma/client';
import fp from 'fastify-plugin';
import type { AppFastifyInstance, AuditEvent } from '../types/app.js';

// Registered with fastify-plugin so every route can reach it. It lives apart from the observability
// plugin because that plugin's hooks must stay scoped: they label metrics with raw URLs.
const auditPlugin = async (fastify: AppFastifyInstance) => {
  fastify.decorate('audit', async (event: AuditEvent) => {
    try {
      await fastify.prisma?.auditLog.create({
        data: {
          orgId: event.orgId ?? null,
          userId: event.userId,
          role: event.role,
          action: event.action,
          timestamp: new Date(),
          metadata: (event.metadata ?? null) as Prisma.InputJsonValue | null,
        },
      });

      fastify.log.info(
        {
          orgId: event.orgId,
          userId: event.userId,
          role: event.role,
          action: event.action,
          targetUserId: event.targetUserId,
        },
        'Audit event logged'
      );
    } catch (error) {
      fastify.log.error(error, 'Failed to log audit event');
    }
  });

  fastify.decorateRequest('audit', fastify.audit);
};

export default fp(auditPlugin, {
  name: 'audit-plugin',
});
