// @ts-nocheck
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

import type { FastifyInstance } from 'fastify';

export type AppFastifyInstance = FastifyInstance & {
  prisma: PrismaClient;
  auth: Auth;
  audit(event: AuditEvent): Promise<void>;
  register: <T = any>(...args: any[]) => T;
  get: <T = any>(...args: any[]) => T;
  post: <T = any>(...args: any[]) => T;
  put: <T = any>(...args: any[]) => T;
  patch: <T = any>(...args: any[]) => T;
  delete: <T = any>(...args: any[]) => T;
  all: <T = any>(...args: any[]) => T;
  options: <T = any>(...args: any[]) => T;
  route: <T = any>(...args: any[]) => T;
  setErrorHandler: (...args: any[]) => any;
  setNotFoundHandler: (...args: any[]) => any;
  listen: (...args: any[]) => any;
  close: () => Promise<void>;
  decorate: (...args: any[]) => any;
  decorateRequest: (...args: any[]) => any;
  addHook: (...args: any[]) => any;
  log: any;
};
