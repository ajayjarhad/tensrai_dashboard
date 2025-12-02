import { z } from 'zod';

import { fetchMapViaMappingBridge } from '../services/saveMapFromMapping.js';
import type { AppFastifyInstance } from '../types/app.js';

const RobotModeSchema = z.enum([
  'MISSION',
  'DOCKING',
  'CHARGING',
  'SW_EMERGENCY',
  'HW_EMERGENCY',
  'TELEOP',
  'HRI',
  'UNKNOWN',
]);

const CreateRobotSchema = z.object({
  name: z.string().min(1),
  status: RobotModeSchema.optional(),
  mapId: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  theta: z.number().optional(),
  ipAddress: z.string().optional(),
  bridgePort: z.number().int().min(1).max(65535).optional(),
  mappingBridgePort: z.number().int().min(1).max(65535).optional(),
  channels: z
    .array(
      z.object({
        name: z.string(),
        topic: z.string(),
        msgType: z.string(),
        direction: z.union([z.literal('subscribe'), z.literal('publish')]),
        rateLimitHz: z.number().positive().optional(),
        connectionId: z.string().optional(),
      })
    )
    .optional(),
});

const UpdateRobotSchema = z.object({
  status: RobotModeSchema.optional(),
  battery: z.number().min(0).max(100).optional(),
  mapId: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  theta: z.number().optional(),
  ipAddress: z.string().optional(),
  bridgePort: z.number().int().min(1).max(65535).optional(),
  mappingBridgePort: z.number().int().min(1).max(65535).optional(),
  channels: z
    .array(
      z.object({
        name: z.string(),
        topic: z.string(),
        msgType: z.string(),
        direction: z.union([z.literal('subscribe'), z.literal('publish')]),
        rateLimitHz: z.number().positive().optional(),
        connectionId: z.string().optional(),
      })
    )
    .optional(),
});

const robotRoutes: any = async (server: AppFastifyInstance) => {
  // List all robots
  server.get('/robots', async (_request: any, _replyy: any) => {
    const prisma = server.prisma as any;
    const robots = await prisma.robot.findMany({
      orderBy: { name: 'asc' },
    });
    return { success: true, data: robots };
  });

  // Get single robot
  server.get<{ Params: { id: string } }>('/robots/:id', async (request: any, reply: any) => {
    const { id } = request.params;
    const prisma = server.prisma as any;
    const robot = await prisma.robot.findUnique({
      where: { id },
    });

    if (!robot) {
      return reply.status(404).send({ success: false, error: 'Robot not found' });
    }

    return { success: true, data: robot };
  });

  // Create robot (Backend/Testing only)
  server.post<{ Body: z.infer<typeof CreateRobotSchema> }>(
    '/robots',
    async (request: any, reply: any) => {
      const result = CreateRobotSchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({ success: false, error: result.error });
      }

      const { name, mapId, channels, ...data } = result.data;
      const prisma = server.prisma as any;

      try {
        const robot = await prisma.robot.create({
          data: {
            name,
            ...data,
            status: data.status || 'UNKNOWN',
            channels: channels ?? undefined,
            ...(mapId
              ? {
                  map: {
                    connect: { id: mapId },
                  },
                }
              : {}),
          } as any,
        });
        (server as any).rosRegistry?.reloadFromDb?.().catch(() => {});
        // Try to fetch and store map in the background (fire and forget)
        fetchMapViaMappingBridge(server, robot).catch(() => {});
        return { success: true, data: robot };
      } catch (error: any) {
        if (error.code === 'P2002') {
          return reply
            .status(409)
            .send({ success: false, error: 'Robot with this name already exists' });
        }
        throw error;
      }
    }
  );

  // Update robot (Heartbeat/Status)
  server.patch<{ Params: { id: string }; Body: z.infer<typeof UpdateRobotSchema> }>(
    '/robots/:id',
    async (request: any, reply: any) => {
      const { id } = request.params;
      const result = UpdateRobotSchema.safeParse(request.body);

      if (!result.success) {
        return reply.status(400).send({ success: false, error: result.error });
      }

      const prisma = server.prisma as any;

      try {
        const { mapId, channels, ...rest } = result.data;
        const robot = await prisma.robot.update({
          where: { id },
          data: {
            ...rest,
            ...(mapId !== undefined
              ? {
                  map: mapId
                    ? {
                        connect: { id: mapId },
                      }
                    : { disconnect: true },
                }
              : {}),
            channels: channels ?? undefined,
            lastSeen: new Date(),
          } as any,
        });
        (server as any).rosRegistry?.reloadFromDb?.().catch(() => {});
        fetchMapViaMappingBridge(server, robot).catch(() => {});
        return { success: true, data: robot };
      } catch (error: any) {
        if (error.code === 'P2025') {
          return reply.status(404).send({ success: false, error: 'Robot not found' });
        }
        throw error;
      }
    }
  );

  // Delete robot
  server.delete<{ Params: { id: string } }>('/robots/:id', async (request: any, reply: any) => {
    const { id } = request.params;
    const prisma = server.prisma as any;
    try {
      await prisma.robot.delete({
        where: { id },
      });
      (server as any).rosRegistry?.reloadFromDb?.().catch(() => {});
      return { success: true, message: 'Robot deleted successfully' };
    } catch (error: any) {
      if (error.code === 'P2025') {
        return reply.status(404).send({ success: false, error: 'Robot not found' });
      }
      throw error;
    }
  });
};

export default robotRoutes;
