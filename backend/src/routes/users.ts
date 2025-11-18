import { requireAdmin } from '../middleware/auth.js';
import {
  createUserWithTempPassword,
  deleteUser,
  getAllUsers,
  getUserById,
  resetPasswordWithTemp,
  updateUser,
} from '../services/user.service.js';
import type { AppFastifyInstance, AppFastifyReply, AppFastifyRequest } from '../types/app.js';

export default async function userRoutes(fastify: AppFastifyInstance) {
  fastify.post(
    '/users',
    {
      preHandler: [requireAdmin],
      schema: {
        body: {
          type: 'object',
          required: ['username', 'email', 'role'],
          properties: {
            username: { type: 'string', minLength: 3, maxLength: 50 },
            email: { type: 'string', format: 'email' },
            role: { type: 'string', enum: ['ADMIN', 'USER'] },
            displayName: { type: 'string', maxLength: 100 },
          },
        },
      },
    },
    async (request: AppFastifyRequest, reply: AppFastifyReply) => {
      try {
        const currentUser = await request.getCurrentUser();

        if (!currentUser) {
          return reply.code(401).send({
            success: false,
            error: 'Authentication required',
          });
        }

        const userData = request.body;
        const result = await createUserWithTempPassword(
          fastify.prisma,
          userData,
          currentUser.id,
          currentUser.role
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
      preHandler: [requireAdmin],
    },
    async (request: AppFastifyRequest, reply: AppFastifyReply) => {
      try {
        const currentUser = await request.getCurrentUser();

        if (!currentUser) {
          return reply.code(401).send({
            success: false,
            error: 'Authentication required',
          });
        }

        const users = await getAllUsers(fastify.prisma);

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

  fastify.get(
    '/users/:id',
    {
      preHandler: [requireAdmin],
    },
    async (request: AppFastifyRequest, reply: AppFastifyReply) => {
      try {
        const currentUser = await request.getCurrentUser();

        if (!currentUser) {
          return reply.code(401).send({
            success: false,
            error: 'Authentication required',
          });
        }

        const { id } = request.params;
        const user = await getUserById(fastify.prisma, id);

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

  fastify.put(
    '/users/:id',
    {
      preHandler: [requireAdmin],
    },
    async (request: AppFastifyRequest, reply: AppFastifyReply) => {
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
          fastify.prisma,
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
        fastify.log.error(error, 'Failed to update user');

        return reply.code(400).send({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update user',
        });
      }
    }
  );

  fastify.delete(
    '/users/:id',
    {
      preHandler: [requireAdmin],
    },
    async (request: AppFastifyRequest, reply: AppFastifyReply) => {
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

        await deleteUser(fastify.prisma, id, currentUser.id, currentUser.role);

        return reply.send({
          success: true,
          message: 'User deleted successfully',
        });
      } catch (error) {
        fastify.log.error(error, 'Failed to delete user');

        return reply.code(400).send({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete user',
        });
      }
    }
  );

  fastify.post(
    '/auth/first-time-setup',
    {
      config: {
        rateLimit: {
          max: 3,
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
    async (request: AppFastifyRequest, reply: AppFastifyReply) => {
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
