import type { IncomingMessage, ServerResponse } from 'node:http';
import { auth } from '../config/auth.js';
import type { AppFastifyInstance, AppFastifyReply, AppFastifyRequest } from '../types/app.js';

const authPlugin = async (fastify: AppFastifyInstance) => {
  // Initialize auth with the shared Prisma client
  const authInstance = auth(fastify.prisma);
  fastify.decorate('auth', authInstance);

  fastify.decorateRequest('getUserSession', async function (this: AppFastifyRequest) {
    try {
      const session = await authInstance.api.getSession({
        headers: this.headers,
      });
      return session;
    } catch {
      return null;
    }
  });

  fastify.decorateRequest('getCurrentUser', async function (this: AppFastifyRequest) {
    const session = await this.getUserSession();
    return session?.user ?? null;
  });

  fastify.decorateRequest('isAuthenticated', async function (this: AppFastifyRequest) {
    const session = await this.getUserSession();
    return Boolean(session?.user);
  });

  fastify.decorateRequest('hasRole', async function (this: AppFastifyRequest, role: string) {
    const user = await this.getCurrentUser();
    return user?.role === role;
  });

  // Register Better Auth handler with proper URL handling
  const handler = authInstance.handler as unknown as (
    req: IncomingMessage,
    res: ServerResponse
  ) => Promise<void>;

  const allowedOrigins = [
    process.env['FRONTEND_URL'],
    'http://localhost:5000',
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:3000',
  ].filter(Boolean) as string[];

  const applyCorsHeaders = (request: AppFastifyRequest, reply: AppFastifyReply) => {
    const origin = request.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.raw.setHeader('Access-Control-Allow-Origin', origin);
    }
    const credentials = 'true';
    const allowHeaders =
      'Origin, X-Requested-With, Accept, Authorization, Content-Type, Cache-Control, Pragma';
    const allowMethods = 'GET, POST, PUT, DELETE, PATCH, OPTIONS';
    reply.header('Access-Control-Allow-Credentials', credentials);
    reply.header('Access-Control-Allow-Headers', allowHeaders);
    reply.header('Access-Control-Allow-Methods', allowMethods);
    reply.header('Access-Control-Expose-Headers', 'Set-Cookie');
    reply.header('Vary', 'Origin');

    reply.raw.setHeader('Access-Control-Allow-Credentials', credentials);
    reply.raw.setHeader('Access-Control-Allow-Headers', allowHeaders);
    reply.raw.setHeader('Access-Control-Allow-Methods', allowMethods);
    reply.raw.setHeader('Access-Control-Expose-Headers', 'Set-Cookie');
    reply.raw.setHeader('Vary', 'Origin');
  };

  fastify.options('/api/auth/*', async (request: AppFastifyRequest, reply: AppFastifyReply) => {
    applyCorsHeaders(request, reply);
    reply.header('Content-Length', '0');
    reply.status(204).send();
  });

  // Register auth routes with CORS
  fastify.route({
    method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    url: '/api/auth/*',
    handler: async (request: AppFastifyRequest, reply: AppFastifyReply) => {
      try {
        applyCorsHeaders(request, reply);
        // Set proper host for Better Auth
        const originalHost = request.headers.host;
        const host = originalHost || 'localhost:5001';
        const protocolHeader = request.headers['x-forwarded-proto'];
        const protocol = Array.isArray(protocolHeader)
          ? protocolHeader[0]
          : protocolHeader?.split(',')[0];
        const scheme = protocol?.trim() || 'http';

        // Ensure Better Auth has the correct base URL
        if (!authInstance.options.baseURL) {
          authInstance.options.baseURL = `http://${host}`;
        }

        const rawNodeRequest = request.raw;
        const originalUrl = rawNodeRequest.url ?? '/';

        // Strip the /api/auth prefix so Better Auth receives the path it expects
        const rewrittenPath = originalUrl.replace(/^\/api\/auth/, '') || '/';
        const normalizedPath = rewrittenPath.startsWith('/') ? rewrittenPath : `/${rewrittenPath}`;
        const absoluteUrl = `${scheme}://${host}${normalizedPath}`;
        rawNodeRequest.url = absoluteUrl;

        await handler(rawNodeRequest, reply.raw);

        // Restore original URL in case downstream hooks rely on it
        rawNodeRequest.url = originalUrl;
      } catch (error) {
        fastify.log.error(error, 'Better Auth handler error');
        reply.status(500).send({
          success: false,
          error: 'Authentication service error',
          code: 'AUTH_ERROR',
        });
      }
    },
  });
};

export default authPlugin;
