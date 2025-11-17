import { PrismaClient } from '@prisma/client';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';

const databaseUrl = process.env['DATABASE_URL'] ?? 'mongodb://localhost:27017/tensrai_dashboard';
const baseUrl = process.env['BASE_URL'] ?? 'http://localhost:5001';
const frontendUrl = process.env['FRONTEND_URL'] ?? 'http://localhost:3000';
const nodeEnv = process.env['NODE_ENV'] ?? 'development';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: databaseUrl,
    },
  },
});

export const auth = betterAuth({
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

  socialProviders: {},

  rateLimit: {
    window: 60,
    max: 100,
    storage: 'memory',
  },

  trustedOrigins: [frontendUrl, 'http://localhost:5000'],

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

export type Auth = typeof auth;
