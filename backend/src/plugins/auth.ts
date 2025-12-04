import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { runWithEndpointContext } from '@better-auth/core/context';
import bcrypt from 'bcryptjs';
import cookie from 'cookie';
import fp from 'fastify-plugin';
import { auth } from '../config/auth.js';
import type { AppFastifyInstance, AppFastifyReply, AppFastifyRequest } from '../types/app.js';

const toFetchHeaders = (headers: IncomingHttpHeaders) => {
  const converted = new Headers();

  for (const [key, value] of Object.entries(headers)) {
    if (!key) continue;

    if (typeof value === 'string') {
      converted.set(key, value);
    } else if (Array.isArray(value)) {
      converted.set(key, value.join(','));
    }
  }

  return converted;
};

type AuthMethod = 'password' | 'temporary';

type AuthenticatedUser = {
  id: string;
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
  username: user.username,
  email: user.email,
  role: user.role,
  displayName: user.displayName,
  mustResetPassword: overrides.mustResetPassword ?? user.mustResetPassword,
});

const hasTemporaryCredentials = (user: PrismaAuthUser) =>
  Boolean(user.tempPasswordHash && user.tempPasswordExpiry);

const credentialsAreMissing = (username: string, password: string) => !username || !password;

const ensureActiveUser = (user: PrismaAuthUser | null): RouteResult<PrismaAuthUser> => {
  if (!user) {
    return err(createRouteError(400, 'INVALID_CREDENTIALS', 'Invalid username or password'));
  }

  if (!user.isActive) {
    return err(createRouteError(403, 'ACCOUNT_INACTIVE', 'Account is inactive'));
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
    return createErrorResponse('temporary', 'Temporary password has expired');
  }

  const isValidTempPassword = await bcrypt.compare(password, user.tempPasswordHash ?? '');
  if (!isValidTempPassword) {
    return createErrorResponse('temporary', 'Invalid temporary password');
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
    return createErrorResponse(
      'password',
      'Account setup incomplete. Please contact administrator.'
    );
  }

  const isValidPassword = await bcrypt.compare(password, user.passwordHash);
  if (!isValidPassword) {
    return createErrorResponse('password', 'Invalid password');
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
      const { error } = validatedUser;
      return createErrorResponse('password', error.body.error);
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

const initializeAuthInstance = (
  fastify: AppFastifyInstance,
  getAuthInstance: () => ReturnType<typeof auth>
): RouteResult<ReturnType<typeof auth>> => {
  try {
    return ok(getAuthInstance());
  } catch (error) {
    fastify.log.error(error, 'Failed to initialize authentication service');
    return err(createRouteError(500, 'AUTH_ERROR', 'Authentication service not available'));
  }
};

type SessionUser = {
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

type NormalizedSession = Record<string, unknown> & {
  sessionToken?: string;
  token?: string;
  expiresAt?: Date;
};

const normalizeSession = (session: Record<string, unknown>): NormalizedSession => {
  const normalized: NormalizedSession = { ...session };
  const sessionToken = (session['sessionToken'] as string | undefined) ?? (session as any).token;

  if (sessionToken !== undefined) {
    normalized.sessionToken = sessionToken;
  }

  const token = session['token'];
  if (typeof token === 'string') {
    normalized.token = token;
  }

  const expiresAt = session['expiresAt'];
  if (expiresAt instanceof Date) {
    normalized.expiresAt = expiresAt;
  }

  return normalized;
};

const createSessionForUser = async (
  fastify: AppFastifyInstance,
  authInstance: ReturnType<typeof auth>,
  request: AppFastifyRequest,
  userId: string
): Promise<RouteResult<NormalizedSession>> => {
  const authContext = await authInstance.$context;

  if (!authContext?.internalAdapter?.createSession) {
    fastify.log.error('Better Auth context does not expose a session creator');
    return err(createRouteError(500, 'AUTH_ERROR', 'Authentication service not available'));
  }

  const sessionHeaders = toFetchHeaders(request.headers);
  const endpointContext = {
    headers: sessionHeaders,
    request: request.raw,
    path: '/api/auth/sign-in',
    context: {
      ...authContext,
      returned: undefined,
      responseHeaders: undefined,
      session: null,
    },
  } as any;

  const session = await runWithEndpointContext(endpointContext, () =>
    authContext.internalAdapter.createSession(userId)
  );

  if (!session) {
    return err(createRouteError(500, 'SESSION_ERROR', 'Failed to create session'));
  }

  return ok(normalizeSession(session as Record<string, unknown>));
};

const buildEnhancedUser = (
  sessionUser: SessionUser,
  authenticatedUser: AuthenticatedUser,
  authResult: AuthSuccess
) => ({
  id: authenticatedUser.id,
  username: sessionUser.username,
  email: sessionUser.email,
  role: sessionUser.role,
  displayName: sessionUser.displayName,
  isActive: sessionUser.isActive,
  mustResetPassword: authResult.requiresPasswordSetup || sessionUser.mustResetPassword,
  authMethod: authResult.authMethod,
  requiresPasswordSetup: authResult.requiresPasswordSetup,
});

const setSessionCookie = (reply: AppFastifyReply, session: NormalizedSession) => {
  const sessionToken = session.sessionToken;
  if (!sessionToken) {
    return;
  }

  const expiresAt =
    session.expiresAt instanceof Date
      ? session.expiresAt
      : new Date(Date.now() + 60 * 60 * 24 * 7 * 1000);

  const maxAge =
    Math.max(Math.floor((expiresAt.getTime() - Date.now()) / 1000), 0) || 60 * 60 * 24 * 7;

  const serializedCookie = cookie.serialize('better-auth.session_token', sessionToken, {
    path: '/',
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'lax',
    maxAge,
    expires: expiresAt,
  });

  reply.header('Set-Cookie', serializedCookie);
};

const finalizeAuthentication = async (
  fastify: AppFastifyInstance,
  request: AppFastifyRequest,
  reply: AppFastifyReply,
  prisma: any,
  authResult: AuthSuccess,
  getAuthInstance: () => ReturnType<typeof auth>
): Promise<
  RouteResult<{
    session: NormalizedSession;
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

  const authInstanceResult = initializeAuthInstance(fastify, getAuthInstance);
  if (!authInstanceResult.ok) {
    return authInstanceResult;
  }

  const sessionUserResult = await fetchSessionUser(prisma, authenticatedUser.id);
  if (!sessionUserResult.ok) {
    return sessionUserResult;
  }

  const sessionResult = await createSessionForUser(
    fastify,
    authInstanceResult.value,
    request,
    authenticatedUser.id
  );
  if (!sessionResult.ok) {
    return sessionResult;
  }

  const enhancedUser = buildEnhancedUser(sessionUserResult.value, authenticatedUser, authResult);

  setSessionCookie(reply, sessionResult.value);

  return ok({
    session: sessionResult.value,
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

const extractSessionToken = (headers: IncomingHttpHeaders): string | null => {
  const authHeader = headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim() || null;
  }

  const headerToken =
    (typeof headers['x-session-token'] === 'string' && headers['x-session-token']) ||
    (typeof headers['session-token'] === 'string' && headers['session-token']);
  if (headerToken) {
    return headerToken;
  }

  const parsedCookies = parseCookieHeader(headers['cookie']);
  if (!parsedCookies) {
    return null;
  }

  return parsedCookies['better-auth.session_token'] ?? parsedCookies['session-token'] ?? null;
};

const fetchSessionFromDatabase = async (fastify: AppFastifyInstance, token: string) => {
  try {
    const sessionRecord = await fastify.prisma.session.findUnique({
      where: { token },
      include: {
        user: {
          select: {
            id: true,
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

    if (!sessionRecord) {
      return null;
    }

    if (sessionRecord.expiresAt < new Date()) {
      return null;
    }

    return {
      session: {
        id: sessionRecord.id,
        token: sessionRecord.token,
        expiresAt: sessionRecord.expiresAt,
        createdAt: sessionRecord.createdAt,
        updatedAt: sessionRecord.updatedAt,
      },
      user: sessionRecord.user,
    };
  } catch (error) {
    fastify.log.error(error, 'Failed to fetch session from database');
    return null;
  }
};

const authPlugin = async (fastify: AppFastifyInstance) => {
  // Initialize auth with the shared Prisma client (will access prisma when needed)
  let authInstance: any = null;
  fastify.decorate('auth', null as unknown as ReturnType<typeof auth>);

  // Lazy initialization - only create auth instance when needed
  const getAuthInstance = () => {
    if (!authInstance) {
      if (!fastify.prisma) {
        throw new Error('Prisma not available for auth instance creation');
      }
      authInstance = auth(fastify.prisma);
      (fastify as any).auth = authInstance;
    }
    return authInstance;
  };

  // Custom auth service now handled directly in routes

  fastify.decorateRequest('getUserSession', async function (this: AppFastifyRequest) {
    try {
      const authInstance = getAuthInstance();
      const session = await authInstance.api.getSession({
        headers: toFetchHeaders(this.headers),
      });

      if (session?.user) {
        return session;
      }
    } catch (error) {
      fastify.log.debug({ error }, 'Primary session lookup failed, attempting database fallback');
    }

    const token = extractSessionToken(this.headers);
    if (!token) {
      return null;
    }

    return fetchSessionFromDatabase(fastify, token);
  });

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

  // Register Better Auth handler with proper URL handling
  const getHandler = () => {
    const instance = getAuthInstance();
    return instance.handler as unknown as (
      req: IncomingMessage,
      res: ServerResponse
    ) => Promise<void>;
  };

  const localDevOrigins = Array.from({ length: 10 }, (_, idx) => `http://localhost:${5001 + idx}`);
  const allowedOrigins = [
    process.env['FRONTEND_URL'],
    'http://localhost:5000',
    'http://localhost:5173',
    'http://localhost:5174',
    ...localDevOrigins,
  ].filter(Boolean) as string[];
  const allowedOriginSet = new Set(allowedOrigins.map(origin => origin.toLowerCase()));

  const isAllowedOrigin = (origin?: string | null) => {
    if (!origin) return false;
    const normalized = origin.toLowerCase();
    if (allowedOriginSet.has(normalized)) {
      return true;
    }

    try {
      const parsed = new URL(origin);
      const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
      if (
        (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
        port >= 5001 &&
        port <= 5010
      ) {
        return true;
      }
    } catch {
      return false;
    }

    return false;
  };

  const applyCorsHeaders = (request: AppFastifyRequest, reply: AppFastifyReply) => {
    const origin = request.headers.origin;
    if (isAllowedOrigin(origin)) {
      if (origin) {
        reply.header('Access-Control-Allow-Origin', origin);
        reply.raw.setHeader('Access-Control-Allow-Origin', origin);
      }
    } else {
      reply.removeHeader('Access-Control-Allow-Origin');
      reply.raw.removeHeader('Access-Control-Allow-Origin');
    }
    const credentials = 'true';
    const allowHeaders =
      'Origin, X-Requested-With, Accept, Authorization, Content-Type, Cache-Control, Pragma';
    const allowMethods = 'GET, POST, PUT, DELETE, PATCH, OPTIONS';
    reply.header('Access-Control-Allow-Credentials', credentials);
    reply.header('Access-Control-Allow-Headers', allowHeaders);
    reply.header('Access-Control-Allow-Methods', allowMethods);
    reply.header('Access-Control-Expose-Headers', 'Set-Cookie');
    reply.header('Vary', 'Origin');

    reply.raw.setHeader('Access-Control-Allow-Credentials', credentials);
    reply.raw.setHeader('Access-Control-Allow-Headers', allowHeaders);
    reply.raw.setHeader('Access-Control-Allow-Methods', allowMethods);
    reply.raw.setHeader('Access-Control-Expose-Headers', 'Set-Cookie');
    reply.raw.setHeader('Vary', 'Origin');
  };

  fastify.options('/api/auth/*', async (request: AppFastifyRequest, reply: AppFastifyReply) => {
    applyCorsHeaders(request, reply);
    reply.header('Content-Length', '0');
    reply.status(204).send();
  });

  // Session validation endpoint for frontend
  fastify.get('/api/auth/session', async (request: AppFastifyRequest, reply: AppFastifyReply) => {
    try {
      applyCorsHeaders(request, reply);

      // Ensure auth instance is initialized
      const authInstance = getAuthInstance();
      if (!authInstance) {
        return reply.status(500).send({
          success: false,
          error: 'Authentication service not available',
          code: 'AUTH_SERVICE_ERROR',
        });
      }

      // Get session from Better Auth
      const session = await authInstance.api.getSession({
        headers: request.headers,
      });

      if (!session || !session.user) {
        return reply.status(401).send({
          success: false,
          error: 'No valid session found',
          code: 'NO_SESSION',
        });
      }

      return reply.send({
        success: true,
        user: session.user,
        session: session.session,
      });
    } catch (error) {
      fastify.log.error('Session validation error:', error);
      return reply.status(500).send({
        success: false,
        error: 'Session validation failed',
        code: 'SESSION_ERROR',
      });
    }
  });

  // Custom sign-in route that handles both regular and temporary passwords
  fastify.post('/api/auth/sign-in', async (request: AppFastifyRequest, reply: AppFastifyReply) => {
    try {
      applyCorsHeaders(request, reply);

      const credentialsResult = extractCredentials(request.body);
      if (!credentialsResult.ok) {
        return reply.status(credentialsResult.error.status).send(credentialsResult.error.body);
      }

      const prismaResult = ensurePrisma(fastify);
      if (!prismaResult.ok) {
        return reply.status(prismaResult.error.status).send(prismaResult.error.body);
      }

      const { username, password } = credentialsResult.value;
      const authResult = await authenticateUserWithPrisma(prismaResult.value, username, password);

      if (!authResult.success) {
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
        authResult,
        getAuthInstance
      );

      if (!finalResult.ok) {
        return reply.status(finalResult.error.status).send(finalResult.error.body);
      }

      return reply.send({
        success: true,
        user: finalResult.value.user,
        session: finalResult.value.session,
        authMethod: finalResult.value.authMethod,
        requiresPasswordSetup: finalResult.value.requiresPasswordSetup,
      });
    } catch (error) {
      fastify.log.error(error, 'Custom authentication error');
      return reply.status(500).send({
        success: false,
        error: 'Authentication service error',
        code: 'AUTH_ERROR',
      });
    }
  });

  // Register auth routes with CORS (excluding sign-in which we handle separately)
  fastify.route({
    method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    url: '/api/auth/*',
    handler: async (request: AppFastifyRequest, reply: AppFastifyReply) => {
      try {
        applyCorsHeaders(request, reply);

        // Skip sign-in endpoint - we handle it with custom logic above
        if (request.url?.includes('/api/auth/sign-in') && request.method === 'POST') {
          reply.code(404).send({
            success: false,
            error: 'Not found',
            code: 'NOT_FOUND',
          });
          return;
        }

        // Set proper host for Better Auth
        const originalHost = request.headers.host;
        const host = originalHost || 'localhost:5001';
        const protocolHeader = request.headers['x-forwarded-proto'];
        const protocol = Array.isArray(protocolHeader)
          ? protocolHeader[0]
          : protocolHeader?.split(',')[0];
        const scheme = protocol?.trim() || 'http';

        // Ensure Better Auth has the correct base URL
        const currentAuthInstance = getAuthInstance();
        if (!currentAuthInstance.options.baseURL) {
          currentAuthInstance.options.baseURL = `http://${host}`;
        }

        const rawNodeRequest = request.raw;
        const originalUrl = rawNodeRequest.url ?? '/';

        // Strip the /api/auth prefix so Better Auth receives the path it expects
        const rewrittenPath = originalUrl.replace(/^\/api\/auth/, '') || '/';
        const normalizedPath = rewrittenPath.startsWith('/') ? rewrittenPath : `/${rewrittenPath}`;
        const absoluteUrl = `${scheme}://${host}${normalizedPath}`;
        rawNodeRequest.url = absoluteUrl;

        await getHandler()(rawNodeRequest, reply.raw);

        // Restore original URL in case downstream hooks rely on it
        rawNodeRequest.url = originalUrl;
      } catch (error) {
        fastify.log.error(error, 'Better Auth handler error');
        reply.status(500).send({
          success: false,
          error: 'Authentication service error',
          code: 'AUTH_ERROR',
        });
      }
    },
  });
};

export default fp(authPlugin, {
  name: 'auth-plugin',
});
