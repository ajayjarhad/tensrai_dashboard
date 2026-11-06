import { requireActiveSession, requireAdmin } from '../middleware/auth.js';
import {
  type CreateUserInput,
  createUserWithTempPassword,
  deleteUser,
  getAllUsers,
  getUserById,
  type ResetPasswordInput,
  resetPasswordWithTemp,
  resetUserPassword,
  ServiceError,
  updateUser,
} from '../services/user.service.js';
import type { AppFastifyInstance, IdParams, SessionUser } from '../types/app.js';

export default async function userRoutes(fastify: AppFastifyInstance) {
  fastify.post<{ Body: CreateUserInput }>(
    '/users',
    {
      onRequest: [requireActiveSession, requireAdmin],
      schema: {
        body: {
          type: 'object',
          required: ['username', 'email', 'role'],
          properties: {
            username: { type: 'string', minLength: 3, maxLength: 50 },
            email: { type: 'string', format: 'email' },
            role: { type: 'string', enum: ['ADMIN', 'USER'] },
            displayName: { type: 'string', maxLength: 100 },
            tempPassword: { type: 'string', minLength: 8, maxLength: 128 },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        let currentUser: SessionUser | null = null;
        try {
          currentUser = await request.getCurrentUser();
        } catch (authError) {
          fastify.log.error({ error: authError }, 'Error getting current user in POST /users');
          return reply.code(401).send({
            success: false,
            error: 'Authentication required',
            code: 'AUTH_ERROR',
          });
        }

        if (!currentUser) {
          return reply.code(401).send({
            success: false,
            error: 'Authentication required',
            code: 'AUTH_REQUIRED',
          });
        }

        const userData = request.body;
        const result = await createUserWithTempPassword(
          fastify.prisma,
          userData,
          currentUser.id,
          currentUser.role,
          request.orgId as string // set by requireActiveSession
        );

        return reply.code(201).send({
          success: true,
          data: result,
          message: 'User created successfully. Share the temporary password with the user.',
        });
      } catch (error) {
        fastify.log.error(error, 'Failed to create user');

        return reply.code(400).send({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create user',
        });
      }
    }
  );

  fastify.get(
    '/users',
    {
      onRequest: [requireActiveSession, requireAdmin],
    },
    async (request, reply) => {
      try {
        const currentUser = await request.getCurrentUser();

        if (!currentUser) {
          return reply.code(401).send({
            success: false,
            error: 'Authentication required',
          });
        }

        const users = await getAllUsers(request.db);

        return reply.send({
          success: true,
          data: users,
          message: 'Users retrieved successfully',
        });
      } catch (error) {
        fastify.log.error(error, 'Failed to get users');

        return reply.code(500).send({
          success: false,
          error: 'Failed to retrieve users',
        });
      }
    }
  );

  fastify.get<IdParams>(
    '/users/:id',
    {
      onRequest: [requireActiveSession, requireAdmin],
    },
    async (request, reply) => {
      try {
        const currentUser = await request.getCurrentUser();

        if (!currentUser) {
          return reply.code(401).send({
            success: false,
            error: 'Authentication required',
          });
        }

        const { id } = request.params;
        const user = await getUserById(request.db, id);

        if (!user) {
          return reply.code(404).send({
            success: false,
            error: 'User not found',
          });
        }

        return reply.send({
          success: true,
          data: user,
          message: 'User retrieved successfully',
        });
      } catch (error) {
        fastify.log.error(error, 'Failed to get user');

        return reply.code(500).send({
          success: false,
          error: 'Failed to retrieve user',
        });
      }
    }
  );

  fastify.put<IdParams & { Body: Parameters<typeof updateUser>[2] }>(
    '/users/:id',
    {
      onRequest: [requireActiveSession, requireAdmin],
      schema: {
        // Anything else in the body is dropped, including nested writes Prisma would accept.
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            username: { type: 'string', minLength: 3, maxLength: 50 },
            email: { type: 'string', format: 'email' },
            role: { type: 'string', enum: ['ADMIN', 'USER'] },
            displayName: { type: 'string', maxLength: 100 },
            isActive: { type: 'boolean' },
            mustResetPassword: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const currentUser = await request.getCurrentUser();

        if (!currentUser) {
          return reply.code(401).send({
            success: false,
            error: 'Authentication required',
          });
        }

        const { id } = request.params;
        const updateData = request.body;

        const updatedUser = await updateUser(
          request.db,
          id,
          updateData,
          currentUser.id,
          currentUser.role
        );

        return reply.send({
          success: true,
          data: updatedUser,
          message: 'User updated successfully',
        });
      } catch (error) {
        if (error instanceof ServiceError) {
          return reply.code(error.status).send({ success: false, error: error.message });
        }
        fastify.log.error(error, 'Failed to update user');

        return reply.code(400).send({
          success: false,
          error: 'Failed to update user',
        });
      }
    }
  );

  fastify.delete<IdParams>(
    '/users/:id',
    {
      onRequest: [requireActiveSession, requireAdmin],
    },
    async (request, reply) => {
      try {
        const currentUser = await request.getCurrentUser();

        if (!currentUser) {
          return reply.code(401).send({
            success: false,
            error: 'Authentication required',
          });
        }

        const { id } = request.params;

        if (id === currentUser.id) {
          return reply.code(400).send({
            success: false,
            error: 'Cannot delete your own account',
          });
        }

        await deleteUser(request.db, id, currentUser.id, currentUser.role);

        return reply.send({
          success: true,
          message: 'User deleted successfully',
        });
      } catch (error) {
        if (error instanceof ServiceError) {
          return reply.code(error.status).send({ success: false, error: error.message });
        }
        fastify.log.error(error, 'Failed to delete user');

        return reply.code(400).send({
          success: false,
          error: 'Failed to delete user',
        });
      }
    }
  );

  fastify.post<IdParams>(
    '/users/:id/reset-password',
    {
      onRequest: [requireActiveSession, requireAdmin],
    },
    async (request, reply) => {
      try {
        const currentUser = await request.getCurrentUser();

        if (!currentUser) {
          return reply.code(401).send({
            success: false,
            error: 'Authentication required',
          });
        }

        const { id } = request.params;
        const result = await resetUserPassword(request.db, id, currentUser.id, currentUser.role);
        return reply.send({ success: true, data: result });
      } catch (error) {
        if (error instanceof ServiceError) {
          return reply.code(error.status).send({ success: false, error: error.message });
        }
        fastify.log.error(error, 'Failed to reset password');
        return reply.code(500).send({ success: false, error: 'Failed to reset password' });
      }
    }
  );

  fastify.post<{ Body: ResetPasswordInput }>(
    '/auth/first-time-setup',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 hour',
        },
      },
      schema: {
        body: {
          type: 'object',
          required: ['tempPassword', 'newPassword', 'confirmPassword'],
          properties: {
            tempPassword: { type: 'string' },
            newPassword: { type: 'string', minLength: 8, maxLength: 128 },
            confirmPassword: { type: 'string' },
            displayName: { type: 'string', maxLength: 100 },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const currentUser = await request.getCurrentUser();

        if (!currentUser) {
          return reply.code(401).send({
            success: false,
            error: 'Authentication required',
          });
        }

        if (!currentUser.mustResetPassword) {
          return reply.code(400).send({
            success: false,
            error: 'First-time setup not required',
          });
        }

        const resetData = request.body;
        const result = await resetPasswordWithTemp(fastify.prisma, currentUser.id, resetData);

        return reply.send({
          success: true,
          message: result.message,
        });
      } catch (error) {
        fastify.log.error(error, 'Failed to complete first-time setup');

        return reply.code(400).send({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to complete first-time setup',
        });
      }
    }
  );
}
