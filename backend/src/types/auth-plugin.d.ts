import type { User } from './shared-shim.js';

export interface AuthSession {
  user: User | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    getUserSession(): Promise<AuthSession | null>;
    getCurrentUser(): Promise<User | null>;
    isAuthenticated(): Promise<boolean>;
    hasRole(role: string): Promise<boolean>;
  }
}
