import { URL } from 'node:url';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fp from 'fastify-plugin';
import type { AppFastifyInstance, AppFastifyReply, AppFastifyRequest } from '../types/app.js';

/**
 * Security plugin for Fastify
 * Sets up security headers, CORS, and rate limiting
 */
const securityPlugin = async (fastify: AppFastifyInstance) => {
  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  });

  const frontendUrl = process.env['FRONTEND_URL'];
  const defaultOrigin = frontendUrl || 'http://localhost:8080';
  const nodeEnv = process.env['NODE_ENV'] ?? 'development';
  const localDevOrigins = Array.from({ length: 10 }, (_, idx) => `http://localhost:${5001 + idx}`);
  const explicitOrigins = [
    frontendUrl || 'http://localhost:5173',
    'http://localhost:5000',
    'http://localhost:5174',
    'http://localhost:8080',
    'http://127.0.0.1:8080',
    ...localDevOrigins,
  ];
  const allowedOriginSet = new Set(
    explicitOrigins.filter(Boolean).map(origin => origin.toLowerCase())
  );

  // Same-origin pages need no entry here: browsers don't apply CORS to them. This list is who else
  // may read responses using the visitor's session, so development is not a reason to allow anyone:
  // compose runs in development by default, and a deployment on plain HTTP has to.
  const isAllowedOrigin = (origin?: string | null) => {
    if (!origin) return true;
    const normalized = origin.toLowerCase();
    if (allowedOriginSet.has(normalized)) {
      return true;
    }

    try {
      const parsed = new URL(origin);
      const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
      if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
        return nodeEnv !== 'production' || (port >= 5001 && port <= 5010);
      }
    } catch {
      // ignore URL parse failures
    }

    return false;
  };
  fastify.decorate('isAllowedOrigin', isAllowedOrigin);

  // Off by default: only routes that opt in through config.rateLimit are limited.
  await fastify.register(rateLimit, { global: false });

  await fastify.register(cors, {
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
      if (isAllowedOrigin(origin)) {
        return cb(null, true);
      }

      fastify.log.warn(
        {
          origin,
          timestamp: new Date().toISOString(),
        },
        'CORS: Unknown origin attempted'
      );

      // No CORS headers, so the browser won't share the response. Failing the request instead
      // would also break a same-origin page whose address isn't on the list.
      return cb(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Origin',
      'X-Requested-With',
      'Accept',
      'Authorization',
      'Content-Type',
      'Cache-Control',
      'Pragma',
      'traceparent',
      'tracestate',
      'baggage',
    ],
    exposedHeaders: ['Set-Cookie'],
  });

  fastify.addHook('onSend', async (_requestt: AppFastifyRequest, reply: AppFastifyReply) => {
    const origin = _requestt.headers.origin;
    if (isAllowedOrigin(origin)) {
      const selectedOrigin = origin || defaultOrigin;
      reply.header('Access-Control-Allow-Origin', selectedOrigin);
      reply.header('Access-Control-Allow-Credentials', 'true');
    }

    reply.header('Server', 'TensraiDashboard');

    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-XSS-Protection', '1; mode=block');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');

    reply.removeHeader('X-Powered-By');
  });

  fastify.addHook('onRequest', async (request: AppFastifyRequest) => {
    const userAgent = request.headers['user-agent'] || '';
    const suspiciousPatterns = [/sqlmap/i, /nmap/i, /nikto/i, /dirb/i, /gobuster/i];
    const isSuspicious = suspiciousPatterns.some(pattern => pattern.test(userAgent));

    if (isSuspicious) {
      fastify.log.warn(
        {
          ip: request.ip,
          userAgent,
          url: request.url,
        },
        'Suspicious user agent detected'
      );
    }
  });

  fastify.get('/health/security', async () => ({
    status: 'healthy',
    security: {
      helmet: 'enabled',
      cors: 'enabled',
      rateLimit: 'auth routes',
      timestamp: new Date().toISOString(),
    },
  }));

  // Helper for routes that need explicit CORS headers (auth plugin does its own)
  fastify.decorate('applyCorsHeaders', (reply: AppFastifyReply, origin?: string | null) => {
    if (!isAllowedOrigin(origin)) return;
    const selectedOrigin = origin || frontendUrl || 'http://localhost:8080';
    reply.header('Access-Control-Allow-Origin', selectedOrigin);
    reply.header('Access-Control-Allow-Credentials', 'true');
    reply.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Accept, Authorization, Content-Type, Cache-Control, Pragma'
    );
    reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    reply.header('Access-Control-Expose-Headers', 'Set-Cookie');
    reply.header('Vary', 'Origin');
  });
};

export default fp(securityPlugin, {
  name: 'security-plugin',
});
