import type { PrismaClient } from '@prisma/client';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';

const getEnv = (key: string, fallback?: string): string => {
  const value = process.env[key];
  if (value && value.length > 0) {
    return value;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new Error(`Missing environment variable ${key}`);
};

const baseUrl = getEnv('BASE_URL', 'http://localhost:5001');
const frontendUrl = getEnv('FRONTEND_URL', 'http://localhost:3000');
const nodeEnv = process.env['NODE_ENV'] ?? 'development';

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
        expiresIn: 60 * 15,
        updateAge: 60 * 5,
        cookieCache: {
          enabled: true,
          maxAge: 5 * 60,
        },
      },

      advanced: {
        generateId: false,
        crossSubDomainCookies: {
          enabled: false,
        },
      },

      emailAndPassword: {
        enabled: true,
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
      sessionTokenExpiration: 60 * 60 * 24 * 7,

      account: {
        accountLinking: {
          enabled: false,
        },
      },

      user: {
        additionalFields: {
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
