import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
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

  await fastify.register(cors, {
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
      const allowedOrigins = [
        frontendUrl || 'http://localhost:5173',
        'http://localhost:3000',
        'http://localhost:5000',
        'http://localhost:5174',
      ];

      if (!origin) return cb(null, true);

      if (allowedOrigins.includes(origin)) {
        return cb(null, true);
      }

      fastify.log.warn(
        {
          origin,
          timestamp: new Date().toISOString(),
        },
        'CORS: Unknown origin attempted'
      );

      return cb(new Error('Not allowed by CORS'), false);
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
    ],
    exposedHeaders: ['Set-Cookie'],
  });

  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    hook: 'preHandler',
    keyGenerator: (request: AppFastifyRequest) => request.ip,
  });

  await fastify.register(rateLimit, {
    max: 5,
    timeWindow: '15 minutes',
    hook: 'preHandler',
    keyGenerator: (request: AppFastifyRequest) => `auth:${request.ip}`,
  });

  fastify.addHook('onSend', async (request: AppFastifyRequest, reply: AppFastifyReply) => {
    const origin = request.headers.origin;
    const allowedOrigins = [
      frontendUrl || 'http://localhost:5173',
      'http://localhost:3000',
      'http://localhost:5000',
      'http://localhost:5174',
    ];

    if (origin && allowedOrigins.includes(origin)) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Vary', 'Origin');
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
    const suspiciousPatterns = [
      /sqlmap/i,
      /nmap/i,
      /nikto/i,
      /dirb/i,
      /gobuster/i,
      /curl/i,
      /wget/i,
    ];

    const isSuspicious = suspiciousPatterns.some(pattern => pattern.test(userAgent));

    if (isSuspicious) {
      fastify.log.warn(
        {
          ip: request.ip,
          userAgent,
          url: request.url,
          timestamp: new Date().toISOString(),
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
      rateLimit: 'enabled',
      timestamp: new Date().toISOString(),
    },
  }));
};

export default securityPlugin;
