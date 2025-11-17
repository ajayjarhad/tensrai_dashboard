import type { PrismaClient } from '@prisma/client';
import type { Auth } from '../config/auth.js';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
    auth: Auth;
    audit(event: {
      userId: string;
      role: string;
      action: string;
      targetUserId?: string;
      metadata?: Record<string, unknown>;
    }): Promise<void>;
  }

  interface FastifyRequest {
    getCurrentUser(): Promise<any>;
    hasRole(role: string): Promise<boolean>;
    isAuthenticated(): Promise<boolean>;
    getUserSession(): Promise<any>;
    audit?: FastifyInstance['audit'];
    startTime?: number;
  }
}
