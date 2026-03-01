import type { AppFastifyInstance } from '../types/app.js';

const missionRunRoutes = async (server: AppFastifyInstance) => {
  server.get('/mission-runs', async (request: any) => {
    const query = (request.query ?? {}) as {
      robotId?: string;
      status?: string;
      limit?: string | number;
    };

    const limitValue =
      typeof query.limit === 'string' ? Number.parseInt(query.limit, 10) : Number(query.limit);

    const runs = await server.missionRegistry?.listMissionRuns({
      robotId: query.robotId,
      status: query.status,
      limit: Number.isFinite(limitValue) ? limitValue : undefined,
    });

    return { success: true, data: runs ?? [] };
  });

  server.get<{ Params: { id: string } }>('/robots/:id/current-mission', async (request: any) => {
    const run = await server.missionRegistry?.getCurrentMission(request.params.id);
    return { success: true, data: run ?? null };
  });
};

export default missionRunRoutes;
