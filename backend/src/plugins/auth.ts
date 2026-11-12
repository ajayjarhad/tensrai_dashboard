import { randomBytes } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { trace } from '@opentelemetry/api';
import type { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import cookie from 'cookie';
import type { FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { authMetrics } from '../metrics/index.js';
import { actingOrgId } from '../middleware/auth.js';
import type { AppFastifyInstance, AppFastifyReply, AppFastifyRequest } from '../types/app.js';

// Named after the library that used to issue it; renaming it would sign everyone out.
const SESSION_COOKIE = 'better-auth.session_token';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 5;
const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 12;

type AuthMethod = 'password' | 'temporary';

type AuthenticatedUser = {
  id: string;
  orgId: string;
  username: string;
  email: string | null;
  role: string;
  displayName: string | null;
  mustResetPassword: boolean;
};

type PrismaAuthUser = AuthenticatedUser & {
  passwordHash: string | null;
  tempPasswordHash: string | null;
  tempPasswordExpiry: Date | null;
  isActive: boolean;
};

type AuthSuccess = {
  success: true;
  user: AuthenticatedUser;
  authMethod: AuthMethod;
  requiresPasswordSetup: boolean;
};

type AuthFailure = {
  success: false;
  user: null;
  authMethod: AuthMethod;
  requiresPasswordSetup: boolean;
  error: string;
};

export type AuthResult = AuthSuccess | AuthFailure;

type RouteError = {
  status: number;
  body: {
    success: false;
    error: string;
    code: string;
    [key: string]: unknown;
  };
};

type RouteResult<T> = { ok: true; value: T } | { ok: false; error: RouteError };

const ok = <T>(value: T): RouteResult<T> => ({ ok: true, value });

const err = <T>(error: RouteError): RouteResult<T> => ({ ok: false, error });

const createRouteError = (
  status: number,
  code: string,
  error: string,
  extras: Record<string, unknown> = {}
): RouteError => ({
  status,
  body: { success: false, error, code, ...extras },
});

const createErrorResponse = (
  authMethod: AuthMethod,
  error: string,
  requiresPasswordSetup = false
): AuthFailure => ({
  success: false,
  user: null,
  authMethod,
  requiresPasswordSetup,
  error,
});

const buildUserPayload = (
  user: PrismaAuthUser,
  overrides: Partial<Pick<AuthenticatedUser, 'mustResetPassword'>> = {}
): AuthenticatedUser => ({
  id: user.id,
  orgId: user.orgId,
  username: user.username,
  email: user.email,
  role: user.role,
  displayName: user.displayName,
  mustResetPassword: overrides.mustResetPassword ?? user.mustResetPassword,
});

const hasTemporaryCredentials = (user: PrismaAuthUser) =>
  Boolean(user.tempPasswordHash && user.tempPasswordExpiry);

const credentialsAreMissing = (username: string, password: string) => !username || !password;

// The same answer for every failure, so sign-in can't reveal which usernames exist in any
// organization, or which of them are disabled.
const INVALID_CREDENTIALS = 'Invalid username or password';

// Compared against when there is no real hash to check, so a missing user takes as long to answer
// as a wrong password. Same cost as the hashes in user.service.ts.
const TIMING_EQUALIZER_HASH = '$2b$12$5tRXLrqRoSl0odYRXR/5e.2joDLjH9dT623tKEW1ILlNkBQQ.MIDe';

const ensureActiveUser = (user: PrismaAuthUser | null): RouteResult<PrismaAuthUser> => {
  if (!user || !user.isActive) {
    return err(createRouteError(400, 'INVALID_CREDENTIALS', INVALID_CREDENTIALS));
  }

  return ok(user);
};

const temporaryPasswordHasExpired = (user: PrismaAuthUser) => {
  if (!user.tempPasswordExpiry) {
    return false;
  }

  return new Date() > user.tempPasswordExpiry;
};

const handleTemporaryPassword = async (
  user: PrismaAuthUser,
  password: string
): Promise<AuthResult | null> => {
  if (!hasTemporaryCredentials(user)) {
    return null;
  }

  if (temporaryPasswordHasExpired(user)) {
    return createErrorResponse('temporary', INVALID_CREDENTIALS);
  }

  const isValidTempPassword = await bcrypt.compare(password, user.tempPasswordHash ?? '');
  if (!isValidTempPassword) {
    return createErrorResponse('temporary', INVALID_CREDENTIALS);
  }

  return {
    success: true,
    user: buildUserPayload(user, { mustResetPassword: true }),
    authMethod: 'temporary',
    requiresPasswordSetup: true,
  };
};

const handlePrimaryPassword = async (
  user: PrismaAuthUser,
  password: string
): Promise<AuthResult> => {
  if (!user.passwordHash) {
    return createErrorResponse('password', INVALID_CREDENTIALS);
  }

  const isValidPassword = await bcrypt.compare(password, user.passwordHash);
  if (!isValidPassword) {
    return createErrorResponse('password', INVALID_CREDENTIALS);
  }

  return {
    success: true,
    user: buildUserPayload(user),
    authMethod: 'password',
    requiresPasswordSetup: user.mustResetPassword,
  };
};

// Direct authentication function that works with prisma
export async function authenticateUserWithPrisma(
  prisma: any,
  username: string,
  password: string
): Promise<AuthResult> {
  try {
    if (credentialsAreMissing(username, password)) {
      return createErrorResponse('password', 'Username and password are required');
    }

    const user = (await prisma.user.findUnique({
      where: { username },
    })) as PrismaAuthUser | null;

    const validatedUser = ensureActiveUser(user);
    if (!validatedUser.ok) {
      await bcrypt.compare(password, TIMING_EQUALIZER_HASH);
      return createErrorResponse('password', INVALID_CREDENTIALS);
    }

    const temporaryResult = await handleTemporaryPassword(validatedUser.value, password);
    if (temporaryResult) {
      return temporaryResult;
    }

    return handlePrimaryPassword(validatedUser.value, password);
  } catch (error) {
    console.error('Authentication error:', error);
    return createErrorResponse('password', 'Authentication failed');
  }
}

const extractCredentials = (body: unknown): RouteResult<{ username: string; password: string }> => {
  if (!body || typeof body !== 'object') {
    return err(createRouteError(400, 'MISSING_CREDENTIALS', 'Username and password are required'));
  }

  const { username, password } = body as Record<string, unknown>;
  if (
    typeof username !== 'string' ||
    typeof password !== 'string' ||
    credentialsAreMissing(username, password)
  ) {
    return err(createRouteError(400, 'MISSING_CREDENTIALS', 'Username and password are required'));
  }

  return ok({ username, password });
};

const ensurePrisma = (fastify: AppFastifyInstance): RouteResult<any> => {
  if (!fastify.prisma) {
    return err(createRouteError(500, 'DATABASE_ERROR', 'Database not available'));
  }

  return ok(fastify.prisma);
};

type SessionUser = {
  orgId: string;
  email: string | null;
  username: string;
  role: string;
  displayName: string | null;
  isActive: boolean;
  mustResetPassword: boolean;
};

const fetchSessionUser = async (prisma: any, userId: string): Promise<RouteResult<SessionUser>> => {
  const sessionUser = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      orgId: true,
      email: true,
      username: true,
      role: true,
      displayName: true,
      isActive: true,
      mustResetPassword: true,
    },
  });

  if (!sessionUser) {
    return err(createRouteError(500, 'AUTH_ERROR', 'User not found for session creation'));
  }

  return ok(sessionUser);
};

const randomId = () => randomBytes(24).toString('base64url');

type CreatedSession = { id: string; token: string; expiresAt: Date };

const createSessionForUser = (
  prisma: PrismaClient,
  request: AppFastifyRequest,
  userId: string
): Promise<CreatedSession> =>
  prisma.session.create({
    data: {
      id: randomId(),
      token: randomId(),
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
    },
    select: { id: true, token: true, expiresAt: true },
  });

const fetchOrgName = async (prisma: any, orgId: string | null | undefined) => {
  if (!orgId) return null;
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { name: true },
  });
  return org?.name ?? null;
};

const buildEnhancedUser = (
  sessionUser: SessionUser,
  authenticatedUser: AuthenticatedUser,
  authResult: AuthSuccess,
  orgName: string | null
) => ({
  id: authenticatedUser.id,
  orgId: sessionUser.orgId,
  homeOrgId: sessionUser.orgId,
  orgName,
  username: sessionUser.username,
  email: sessionUser.email,
  role: sessionUser.role,
  displayName: sessionUser.displayName,
  isActive: sessionUser.isActive,
  mustResetPassword: authResult.requiresPasswordSetup || sessionUser.mustResetPassword,
  authMethod: authResult.authMethod,
  requiresPasswordSetup: authResult.requiresPasswordSetup,
});

const setSessionCookie = (reply: AppFastifyReply, sessionToken: string, expiresAt: Date) => {
  const maxAge = Math.max(Math.floor((expiresAt.getTime() - Date.now()) / 1000), 0);

  const serializedCookie = cookie.serialize(SESSION_COOKIE, sessionToken, {
    path: '/',
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'lax',
    maxAge,
    expires: expiresAt,
  });

  reply.header('Set-Cookie', serializedCookie);
};

const clearSessionCookie = (reply: AppFastifyReply) => setSessionCookie(reply, '', new Date(0));

const finalizeAuthentication = async (
  fastify: AppFastifyInstance,
  request: AppFastifyRequest,
  reply: AppFastifyReply,
  prisma: any,
  authResult: AuthSuccess
): Promise<
  RouteResult<{
    session: CreatedSession;
    user: ReturnType<typeof buildEnhancedUser>;
    authMethod: AuthMethod;
    requiresPasswordSetup: boolean;
  }>
> => {
  const authenticatedUser = authResult.user;
  if (!authenticatedUser) {
    fastify.log.error('Authentication result missing user payload');
    return err(createRouteError(500, 'AUTH_ERROR', 'Authentication service error'));
  }

  const sessionUserResult = await fetchSessionUser(prisma, authenticatedUser.id);
  if (!sessionUserResult.ok) {
    return sessionUserResult;
  }

  const session = await createSessionForUser(prisma, request, authenticatedUser.id);

  const enhancedUser = buildEnhancedUser(
    sessionUserResult.value,
    authenticatedUser,
    authResult,
    await fetchOrgName(prisma, sessionUserResult.value.orgId)
  );

  setSessionCookie(reply, session.token, session.expiresAt);

  return ok({
    session,
    user: enhancedUser,
    authMethod: authResult.authMethod,
    requiresPasswordSetup: authResult.requiresPasswordSetup,
  });
};

const parseCookieHeader = (cookieHeader: string | string[] | undefined) => {
  if (!cookieHeader) {
    return null;
  }

  const raw = Array.isArray(cookieHeader) ? cookieHeader.join(';') : cookieHeader;

  try {
    return cookie.parse(raw);
  } catch {
    return null;
  }
};

// Cookies only: the session cookie is HttpOnly, so a token here is one no page script ever held.
const extractSessionToken = (headers: IncomingHttpHeaders): string | null => {
  const parsedCookies = parseCookieHeader(headers['cookie']);
  if (!parsedCookies) {
    return null;
  }

  return parsedCookies[SESSION_COOKIE] ?? null;
};

const querySession = async (fastify: AppFastifyInstance, token: string) => {
  const sessionRecord = await fastify.prisma.session.findUnique({
    where: { token },
    include: {
      user: {
        select: {
          id: true,
          orgId: true,
          username: true,
          email: true,
          role: true,
          displayName: true,
          isActive: true,
          mustResetPassword: true,
        },
      },
    },
  });

  if (!sessionRecord || sessionRecord.expiresAt < new Date()) {
    return null;
  }

  return {
    session: {
      id: sessionRecord.id,
      token: sessionRecord.token,
      expiresAt: sessionRecord.expiresAt,
      activeOrgId: sessionRecord.activeOrgId,
      createdAt: sessionRecord.createdAt,
      updatedAt: sessionRecord.updatedAt,
    },
    user: sessionRecord.user,
  };
};

const authPlugin = async (fastify: AppFastifyInstance) => {
  // One lookup per request, however many guards and handlers ask for the session.
  fastify.decorateRequest('sessionLookup', null);
  fastify.decorateRequest('getUserSession', function (this: any) {
    this.sessionLookup ??= this.readFreshSession().catch((error: unknown) => {
      fastify.log.error(error, 'Failed to fetch session from database');
      return null;
    });
    return this.sessionLookup;
  });

  // Throws if the database is unreachable, so a socket isn't dropped over a brief outage.
  fastify.decorateRequest('readFreshSession', async function (this: AppFastifyRequest) {
    const token = extractSessionToken(this.headers);
    return token ? querySession(fastify, token) : null;
  });

  // Sliding expiry: a session in use stays alive, one left alone expires after the full TTL.
  fastify.decorateRequest(
    'renewSessionIfStale',
    async function (this: AppFastifyRequest, reply: AppFastifyReply) {
      const session = (await this.getUserSession())?.session;
      if (!session?.token || !(session.expiresAt instanceof Date)) return;

      const renewedAt = session.expiresAt.getTime() - SESSION_TTL_SECONDS * 1000;
      if (Date.now() - renewedAt < SESSION_UPDATE_AGE_SECONDS * 1000) return;

      const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
      try {
        await fastify.prisma.session.updateMany({
          where: { token: session.token },
          data: { expiresAt },
        });
        setSessionCookie(reply, session.token, expiresAt);
      } catch (error) {
        fastify.log.error(error, 'Failed to renew session');
      }
    }
  );

  fastify.decorateRequest('getCurrentUser', async function (this: AppFastifyRequest) {
    const session = await this.getUserSession();
    return session?.user ?? null;
  });

  fastify.decorateRequest('isAuthenticated', async function (this: AppFastifyRequest) {
    const session = await this.getUserSession();
    return Boolean(session?.user);
  });

  fastify.decorateRequest('hasRole', async function (this: AppFastifyRequest, role: string) {
    const user = await this.getCurrentUser();
    return user?.role === role;
  });

  // Session validation endpoint for frontend
  fastify.get('/api/auth/session', async (request: AppFastifyRequest, reply: AppFastifyReply) => {
    try {
      const session = await request.getUserSession();

      if (!session?.user) {
        return reply.status(401).send({
          success: false,
          error: 'No valid session found',
          code: 'NO_SESSION',
        });
      }

      // Allow-list: only these user fields leave the server.
      const {
        id,
        orgId: homeOrgId,
        username,
        email,
        role,
        displayName,
        isActive,
        mustResetPassword,
      } = session.user;
      const orgId = actingOrgId(session);
      return reply.send({
        success: true,
        user: {
          id,
          orgId,
          homeOrgId,
          orgName: await fetchOrgName(fastify.prisma, orgId),
          username,
          email,
          role,
          displayName,
          isActive,
          mustResetPassword,
        },
        session: { sessionId: session.session.id, expiresAt: session.session.expiresAt },
      });
    } catch (error) {
      fastify.log.error(error, 'Session validation error');
      return reply.status(500).send({
        success: false,
        error: 'Session validation failed',
        code: 'SESSION_ERROR',
      });
    }
  });

  fastify.post('/api/auth/sign-out', async (request: AppFastifyRequest, reply: AppFastifyReply) => {
    const user = await request.getCurrentUser();
    const token = extractSessionToken(request.headers);
    if (token) {
      await fastify.prisma.session.deleteMany({ where: { token } });
    }
    if (user && typeof fastify.audit === 'function') {
      await fastify.audit({
        orgId: user.orgId,
        userId: user.id,
        role: user.role,
        action: 'LOGOUT',
      });
    }

    clearSessionCookie(reply);
    return reply.send({ success: true });
  });

  // The account limit below sees one username at a time, so alone it lets an address try a few
  // passwords against every username. This one counts successful sign-ins too, so it is set well
  // above what a whole site behind one address needs. It can't be a second config.rateLimit or
  // fastify.rateLimit: the plugin runs only the first of those on a request.
  const signInAddressLimit = fastify.createRateLimit({ max: 100, timeWindow: '15 minutes' });

  // Custom sign-in route that handles both regular and temporary passwords
  const signInRateLimit = {
    onRequest: async (request: FastifyRequest, reply: AppFastifyReply) => {
      const limit = await signInAddressLimit(request);
      if (limit.isAllowed || !limit.isExceeded) return;

      reply.header('retry-after', limit.ttlInSeconds);
      return reply.code(429).send({
        success: false,
        error: 'Too many sign-in attempts from this address. Try again later.',
        code: 'RATE_LIMITED',
      });
    },
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '15 minutes',
        // After body parsing, so one attacker can't lock everyone out of an account from elsewhere.
        hook: 'preHandler' as const,
        keyGenerator: (request: AppFastifyRequest) =>
          `${request.ip}|${String((request.body as { username?: unknown } | undefined)?.username ?? '').toLowerCase()}`,
      },
    },
  };

  fastify.post(
    '/api/auth/sign-in',
    signInRateLimit,
    async (request: AppFastifyRequest, reply: AppFastifyReply) => {
      const tracer = trace.getTracer('auth-plugin');
      const span = tracer.startSpan('auth.sign-in', {
        attributes: {
          'auth.method': 'password',
          'auth.flow': 'custom-signin',
        },
      });

      try {
        const credentialsResult = extractCredentials(request.body);
        if (!credentialsResult.ok) {
          span.setAttributes({
            'auth.success': false,
            'auth.reason': 'missing_credentials',
          });
          span.end();
          return reply.status(credentialsResult.error.status).send(credentialsResult.error.body);
        }

        const prismaResult = ensurePrisma(fastify);
        if (!prismaResult.ok) {
          span.setAttributes({
            'auth.success': false,
            'auth.reason': 'database_error',
          });
          span.end();
          return reply.status(prismaResult.error.status).send(prismaResult.error.body);
        }

        const { username, password } = credentialsResult.value;

        // Record login attempt
        authMetrics.loginAttempts.add(1, {
          'auth.username': username,
        });

        const authResult = await authenticateUserWithPrisma(prismaResult.value, username, password);

        if (!authResult.success) {
          // Record failed login
          authMetrics.loginFailures.add(1, {
            'auth.username': username,
            'auth.reason': 'invalid_credentials',
            'auth.method': authResult.authMethod,
          });

          span.setAttributes({
            'auth.success': false,
            'auth.reason': authResult.error,
            'auth.method': authResult.authMethod,
          });
          span.end();

          return reply.status(400).send({
            success: false,
            error: authResult.error,
            code: 'INVALID_CREDENTIALS',
            requiresPasswordSetup: false,
          });
        }

        const finalResult = await finalizeAuthentication(
          fastify,
          request,
          reply,
          prismaResult.value,
          authResult
        );

        if (!finalResult.ok) {
          authMetrics.loginFailures.add(1, {
            'auth.username': username,
            'auth.reason': 'session_creation_failed',
          });

          span.setAttributes({
            'auth.success': false,
            'auth.reason': 'session_creation_failed',
          });
          span.end();

          return reply.status(finalResult.error.status).send(finalResult.error.body);
        }

        // Record successful login
        authMetrics.loginSuccess.add(1, {
          'auth.username': username,
          'auth.method': authResult.authMethod,
          'user.role': finalResult.value.user.role,
        });

        // Create audit log entry (guard in case observability plugin is disabled)
        if (typeof (fastify as any).audit === 'function') {
          await fastify.audit({
            orgId: finalResult.value.user.orgId,
            userId: finalResult.value.user.id,
            role: finalResult.value.user.role,
            action: 'LOGIN',
            metadata: {
              authMethod: authResult.authMethod,
              ip: request.ip,
              userAgent: request.headers['user-agent'],
            },
          });
        } else {
          fastify.log.warn(
            { userId: finalResult.value.user.id, action: 'LOGIN' },
            'Audit logger not available; skipping audit event'
          );
        }

        span.setAttributes({
          'auth.success': true,
          'auth.method': authResult.authMethod,
          'user.id': finalResult.value.user.id,
          'user.role': finalResult.value.user.role,
        });
        span.end();

        return reply.send({
          success: true,
          user: finalResult.value.user,
          // Allow-list, the same as /api/auth/session: the session row carries the token.
          session: {
            sessionId: finalResult.value.session.id,
            expiresAt: finalResult.value.session.expiresAt,
          },
          authMethod: finalResult.value.authMethod,
          requiresPasswordSetup: finalResult.value.requiresPasswordSetup,
        });
      } catch (error) {
        authMetrics.loginFailures.add(1, {
          'auth.reason': 'system_error',
        });

        span.recordException(error as Error);
        span.setAttributes({
          'auth.success': false,
          'auth.reason': 'system_error',
        });
        span.end();

        fastify.log.error(error, 'Custom authentication error');
        return reply.status(500).send({
          success: false,
          error: 'Authentication service error',
          code: 'AUTH_ERROR',
        });
      }
    }
  );
};

export default fp(authPlugin, {
  name: 'auth-plugin',
  // Without it the sign-in limits would silently not exist.
  dependencies: ['@fastify/rate-limit'],
});
