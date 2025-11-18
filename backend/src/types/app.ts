import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import type { PrismaClient, User as PrismaUser } from '@prisma/client';
import type { Auth } from '../config/auth.js';

export interface AuditEvent {
  userId: string;
  role: string;
  action: string;
  targetUserId?: string;
  metadata?: Record<string, unknown> | null;
}

export interface AppFastifyReply {
  code: (statusCode: number) => AppFastifyReply;
  status: (statusCode: number) => AppFastifyReply;
  send: (payload?: unknown) => AppFastifyReply;
  header: (name: string, value: string | number | string[]) => AppFastifyReply;
  removeHeader: (name: string) => AppFastifyReply;
  setCookie: (name: string, value: string, options?: Record<string, unknown>) => AppFastifyReply;
  statusCode: number;
  raw: ServerResponse;
}

export interface AppFastifyRequest {
  url: string;
  method: string;
  ip: string;
  headers: IncomingHttpHeaders;
  body: any;
  params: Record<string, string>;
  raw: IncomingMessage;
  startTime?: number;
  getUserSession(): Promise<{ user: PrismaUser | null } | null>;
  getCurrentUser(): Promise<PrismaUser | null>;
  isAuthenticated(): Promise<boolean>;
  hasRole(role: string): Promise<boolean>;
  audit?: AppFastifyInstance['audit'];
}

export interface AppFastifyInstance {
  register: (...args: any[]) => Promise<unknown> | undefined;
  get: (...args: any[]) => void;
  post: (...args: any[]) => void;
  put: (...args: any[]) => void;
  delete: (...args: any[]) => void;
  all: (...args: any[]) => void;
  options: (...args: any[]) => void;
  route: (...args: any[]) => void;
  setErrorHandler: (...args: any[]) => void;
  setNotFoundHandler: (...args: any[]) => void;
  listen: (options: { port: number; host: string }) => Promise<void>;
  close: () => Promise<void>;
  decorate: (name: string, value: unknown) => void;
  decorateRequest: (name: string, value: unknown) => void;
  addHook: (name: string, handler: (...args: any[]) => unknown) => void;
  log: {
    info: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
    level?: string;
  };
  prisma: PrismaClient;
  auth: Auth;
  audit(event: AuditEvent): Promise<void>;
}
