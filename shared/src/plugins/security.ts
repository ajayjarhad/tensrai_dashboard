import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';

/**
 * Security plugin for Fastify
 * Configures CORS, Helmet, Rate Limiting, and other security measures
 */
const securityPlugin: FastifyPluginAsync = async fastify => {
  const frontendUrl = process.env['FRONTEND_URL'] ?? null;

  await fastify.register(cors, {
    origin: frontendUrl
      ? [frontendUrl, 'http://localhost:3000', 'http://localhost:5173']
      : ['http://localhost:3000', 'http://localhost:5173'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'Set-Cookie'],
  });

  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", frontendUrl ?? 'http://localhost:3000'],
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  await fastify.register(rateLimit, {
    max: 100, // 100 requests per window
    timeWindow: '1 minute',
    skipOnError: false,
    keyGenerator: () => {
      return '127.0.0.1';
    },
    errorResponseBuilder: () => {
      return {
        code: 'RATE_LIMIT_EXCEEDED',
        error: 'Rate limit exceeded',
        message: 'Too many requests. Try again later.',
        expiresIn: 60,
      };
    },
  });

  fastify.get('/health/security', async () => ({
    status: 'healthy',
    security: {
      cors: 'enabled',
      helmet: 'enabled',
      rateLimit: 'enabled',
    },
    timestamp: new Date().toISOString(),
  }));

  fastify.log.info('Security plugin loaded successfully');
};

export default securityPlugin;
