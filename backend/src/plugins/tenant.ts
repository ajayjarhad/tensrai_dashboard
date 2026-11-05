import fp from 'fastify-plugin';
import { scopedPrisma } from '../services/orgScope.js';
import type { AppFastifyInstance, AppFastifyRequest } from '../types/app.js';

const tenantPlugin = async (fastify: AppFastifyInstance) => {
  fastify.decorateRequest('orgId', null);
  fastify.decorateRequest('db', {
    getter(this: AppFastifyRequest) {
      if (!this.orgId) throw new Error('request.db used before requireActiveSession set the org');
      return scopedPrisma(this.server.prisma, this.orgId);
    },
  });
};

export default fp(tenantPlugin, {
  name: 'tenant-plugin',
});
