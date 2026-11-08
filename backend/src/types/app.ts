import type { PrismaClient, User as PrismaUser } from '@prisma/client';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { EmergencyRegistry } from '../services/emergencyRegistry.js';
import type { MissionRegistry } from '../services/missionRegistry.js';
import type { ScopedPrisma } from '../services/orgScope.js';

export interface AuditEvent {
  orgId?: string | null;
  userId: string;
  role: string;
  action: string;
  targetUserId?: string;
  metadata?: Record<string, unknown> | null;
}

export type SessionUser = Pick<
  PrismaUser,
  'id' | 'orgId' | 'username' | 'email' | 'role' | 'displayName' | 'isActive' | 'mustResetPassword'
>;

export interface AppSession {
  user: SessionUser | null;
  session: { id: string; token?: string; expiresAt: Date; activeOrgId?: string | null };
}

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
    emergencyRegistry?: EmergencyRegistry;
    missionRegistry?: MissionRegistry;
    audit(event: AuditEvent): Promise<void>;
  }

  interface FastifyRequest {
    startTime?: number;
    // Set by requireActiveSession; db is a Prisma client confined to this organization.
    orgId: string | null;
    db: ScopedPrisma;
    getUserSession(): Promise<AppSession | null>;
    // Reads the session again, ignoring this request's cached copy; for long-lived sockets.
    readFreshSession(): Promise<AppSession | null>;
    renewSessionIfStale(reply: FastifyReply): Promise<void>;
    getCurrentUser(): Promise<SessionUser | null>;
    isAuthenticated(): Promise<boolean>;
    hasRole(role: string): Promise<boolean>;
    audit?: FastifyInstance['audit'];
  }
}

export type IdParams = { Params: { id: string } };

export type AppFastifyInstance = FastifyInstance;
export type AppFastifyReply = FastifyReply;
export type AppFastifyRequest = FastifyRequest;
