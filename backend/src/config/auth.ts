import type { PrismaClient } from '@prisma/client';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';

const baseUrl = process.env['BASE_URL'] || 'http://localhost:5001';
const frontendUrl = process.env['FRONTEND_URL'] || 'http://localhost:5000';
const nodeEnv = process.env['NODE_ENV'] ?? 'development';

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 5;
export const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 12;

// We'll initialize auth with a lazy database adapter that gets the Prisma client at runtime
let authInstance: ReturnType<typeof betterAuth> | null = null;

export const auth = (prisma: PrismaClient) => {
  if (!authInstance) {
    authInstance = betterAuth({
      baseURL: baseUrl,
      database: prismaAdapter(prisma, {
        provider: 'mongodb',
      }),

      session: {
        expiresIn: SESSION_TTL_SECONDS,
        updateAge: SESSION_UPDATE_AGE_SECONDS,
        additionalFields: {
          activeOrgId: {
            type: 'string',
            required: false,
            input: false,
          },
        },
        cookieCache: {
          enabled: true,
          maxAge: 60 * 60 * 24 * 5, // 5 days
        },
      },

      advanced: {
        generateId: false,
        crossSubDomainCookies: {
          enabled: false,
        },
      },

      emailAndPassword: {
        enabled: false, // Disable built-in email/password auth, we use custom handler
        requireEmailVerification: false,
        minPasswordLength: 8,
        maxPasswordLength: 128,
      },

      socialProviders: {} as Record<string, never>,

      rateLimit: {
        window: 60,
        max: 100,
        storage: 'memory',
      },

      trustedOrigins: [frontendUrl, baseUrl],

      secureCookies: nodeEnv === 'production',
      sessionTokenExpiration: 60 * 60 * 24 * 5, // 5 days

      account: {
        accountLinking: {
          enabled: false,
        },
      },

      user: {
        additionalFields: {
          orgId: {
            type: 'string',
            required: false,
            input: false,
          },
          username: {
            type: 'string',
            required: true,
            defaultValue: '',
            input: true,
          },
          role: {
            type: 'string',
            required: true,
            defaultValue: 'USER',
            input: false,
          },
          displayName: {
            type: 'string',
            required: false,
            input: true,
          },
          mustResetPassword: {
            type: 'boolean',
            required: false,
            defaultValue: false,
            input: false,
          },
          tempPasswordHash: {
            type: 'string',
            required: false,
            input: false,
          },
          tempPasswordExpiry: {
            type: 'date',
            required: false,
            input: false,
          },
          isActive: {
            type: 'boolean',
            required: true,
            defaultValue: true,
            input: false,
          },
        },
      },
    });
  }
  return authInstance;
};

export type Auth = ReturnType<typeof auth>;
