import bcrypt from 'bcrypt';
import { type AuthResult, authenticateUserWithPrisma } from '../plugins/auth.js';
import type { AppFastifyInstance } from '../types/app.js';

export class CustomAuthService {
  constructor(private fastify: AppFastifyInstance) {}

  async authenticateUser(username: string, password: string): Promise<AuthResult> {
    try {
      const prisma = (this.fastify as any).prisma;

      if (!prisma) {
        return {
          success: false,
          user: null,
          authMethod: 'password',
          requiresPasswordSetup: false,
          error: 'Database not available',
        };
      }

      return authenticateUserWithPrisma(prisma, username, password);
    } catch (error) {
      this.fastify.log.error(error, 'Authentication error');
      return {
        success: false,
        user: null,
        authMethod: 'password',
        requiresPasswordSetup: false,
        error: 'Authentication failed',
      };
    }
  }

  async createUserSession(authResult: any) {
    try {
      // Get the Better Auth instance
      const authInstance = this.fastify.auth as any;

      // Find user's full record for session creation
      const user = await (this.fastify as any).prisma.user.findUnique({
        where: { id: authResult.user.id },
        select: {
          email: true,
          username: true,
          role: true,
          displayName: true,
          isActive: true,
          mustResetPassword: true,
        },
      });

      if (!user) {
        throw new Error('User not found for session creation');
      }

      const authenticatedUser = authResult.user;
      if (!authenticatedUser) {
        throw new Error('Authentication result missing user payload');
      }

      const authContext = await authInstance.$context;
      const sessionCtx = {
        headers: new Headers(),
        context: authContext,
      } as any;

      const session = await authContext.internalAdapter.createSession(
        authenticatedUser.id,
        sessionCtx,
        false
      );

      // Create enhanced user object with all necessary fields
      const enhancedUser = {
        id: authenticatedUser.id,
        username: user.username,
        email: user.email,
        role: user.role,
        displayName: user.displayName,
        isActive: user.isActive,
        mustResetPassword: authResult.requiresPasswordSetup || user.mustResetPassword,
        // Custom fields for tracking auth state
        authMethod: authResult.authMethod,
        requiresPasswordSetup: authResult.requiresPasswordSetup,
      };

      const sessionRecord = session as Record<string, unknown>;
      const normalizedSession: {
        sessionToken?: string;
        token?: string;
        expiresAt?: Date;
      } = {
        ...session,
        sessionToken:
          (sessionRecord['sessionToken'] as string | undefined) ?? (session as any)?.token,
      };

      return {
        success: true,
        session: normalizedSession,
        user: enhancedUser,
        authMethod: authResult.authMethod,
        requiresPasswordSetup: authResult.requiresPasswordSetup,
      };
    } catch (error) {
      console.error('Session creation error:', error);
      return {
        success: false,
        error: 'Failed to create session',
      };
    }
  }

  async createTempPassword(userId: string, plainPassword: string): Promise<string> {
    const saltRounds = 12;
    const tempPasswordHash = await bcrypt.hash(plainPassword, saltRounds);

    // Set expiry to 72 hours from now
    const tempPasswordExpiry = new Date(Date.now() + 72 * 60 * 60 * 1000);

    await (this.fastify as any).prisma.user.update({
      where: { id: userId },
      data: {
        tempPasswordHash,
        tempPasswordExpiry,
        mustResetPassword: true,
        updatedAt: new Date(),
      },
    });

    return plainPassword;
  }

  async clearTempPassword(userId: string): Promise<void> {
    await (this.fastify as any).prisma.user.update({
      where: { id: userId },
      data: {
        tempPasswordHash: null,
        tempPasswordExpiry: null,
        mustResetPassword: false,
        updatedAt: new Date(),
      },
    });
  }

  async setPasswordHash(userId: string, plainPassword: string): Promise<void> {
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(plainPassword, saltRounds);

    await (this.fastify as any).prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        updatedAt: new Date(),
      },
    });
  }

  async validateTempPassword(tempPassword: string, tempPasswordHash: string): Promise<boolean> {
    return bcrypt.compare(tempPassword, tempPasswordHash);
  }
}
