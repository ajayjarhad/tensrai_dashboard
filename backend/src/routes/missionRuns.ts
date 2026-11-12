import { requireActiveSession, requireOwnedRobot } from '../middleware/auth.js';
import type { AppFastifyInstance, IdParams } from '../types/app.js';

type MissionRunQuery = {
  robotId?: string;
  status?: string;
  limit?: string | number;
};

const missionRunRoutes = async (server: AppFastifyInstance) => {
  server.addHook('onRequest', requireActiveSession);

  server.get<{ Querystring: MissionRunQuery }>('/mission-runs', async request => {
    const { query } = request;

    const limitValue =
      typeof query.limit === 'string' ? Number.parseInt(query.limit, 10) : Number(query.limit);

    const runs = await server.missionRegistry?.listMissionRuns({
      orgId: request.orgId as string, // set by requireActiveSession
      ...(query.robotId ? { robotId: query.robotId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(Number.isFinite(limitValue) ? { limit: limitValue } : {}),
    });

    return { success: true, data: runs ?? [] };
  });

  server.get<IdParams>(
    '/robots/:id/current-mission',
    { onRequest: requireOwnedRobot('id') },
    async request => {
      const run = await server.missionRegistry?.getCurrentMission(request.params.id);
      return { success: true, data: run ?? null };
    }
  );
};

export default missionRunRoutes;
