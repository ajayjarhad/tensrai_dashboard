import type { MissionRunStatus, PrismaClient } from '@prisma/client';

const ACTIVE_STATUSES: MissionRunStatus[] = [
  'PREVIEW_PENDING',
  'SHOWING',
  'START_PENDING',
  'RUNNING',
  'PAUSED',
];
const PREVIEW_STATUSES: MissionRunStatus[] = ['PREVIEW_PENDING', 'SHOWING', 'START_PENDING'];
const PREVIEW_EXPIRY_MS = 30_000;
const PREVIEW_EXPIRED_EVENT = 'SYSTEM_PREVIEW_EXPIRED';
const PREVIEW_EXPIRED_MESSAGE = 'Mission preview expired without start confirmation';

const normalizeMissionId = (value: unknown): string | undefined => {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return text.length ? text : undefined;
};

const normalizeRequestId = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text.length ? text : undefined;
};

const timestampMs = (value: unknown): number | undefined => {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const eventTimestamp = (event: string, payload: any) => {
  if (event === 'ROBOT_STATUS_UPDATE') return timestampMs(payload?.timestamp) ?? Date.now();
  if (event === 'MISSION_COMPLETED') return timestampMs(payload?.completionTime) ?? Date.now();
  if (event === 'WAYPOINT_ACK') return timestampMs(payload?.time) ?? Date.now();
  return timestampMs(payload?.timestamp) ?? Date.now();
};

type LoggerLike = {
  error: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
};

type RobotMissionMeta = {
  robotId: string;
  robotName: string;
  mapId?: string | null;
};

export class MissionRunStore {
  private prisma: PrismaClient;
  private log: LoggerLike;
  private activeRunIdsByRobot = new Map<string, string>();

  constructor(prisma: PrismaClient, log: LoggerLike) {
    this.prisma = prisma;
    this.log = log;
  }

  private isStalePreviewRun(run: any, nowMs = Date.now()) {
    if (!run || !PREVIEW_STATUSES.includes(run.status)) return false;
    const ts =
      (run.lastEventAt ? new Date(run.lastEventAt).getTime() : undefined) ??
      (run.updatedAt ? new Date(run.updatedAt).getTime() : undefined);
    if (!Number.isFinite(ts)) return false;
    return nowMs - (ts as number) > PREVIEW_EXPIRY_MS;
  }

  private async expirePreviewRun(run: any, now = new Date()) {
    const prisma = this.prisma as any;
    const expired = await prisma.missionRun.update({
      where: { id: run.id },
      data: {
        status: 'CANCELLED',
        phase: 'CANCELLED',
        endedAt: run.endedAt ?? now,
        durationMs:
          run.startedAt && !run.durationMs
            ? Math.max(0, now.getTime() - new Date(run.startedAt).getTime())
            : run.durationMs,
        lastMessage: PREVIEW_EXPIRED_MESSAGE,
        lastEvent: PREVIEW_EXPIRED_EVENT,
        lastEventAt: now,
      },
    });
    if (this.activeRunIdsByRobot.get(run.robotId) === run.id) {
      this.activeRunIdsByRobot.delete(run.robotId);
    }
    return expired;
  }

  async hydrateActiveRuns() {
    const prisma = this.prisma as any;
    const runs = await prisma.missionRun.findMany({
      where: { status: { in: ACTIVE_STATUSES } },
      orderBy: { updatedAt: 'desc' },
    });

    this.activeRunIdsByRobot.clear();
    const nowMs = Date.now();
    for (const run of runs) {
      if (this.isStalePreviewRun(run, nowMs)) {
        await this.expirePreviewRun(run, new Date(nowMs));
        continue;
      }
      if (this.activeRunIdsByRobot.has(run.robotId)) continue;
      this.activeRunIdsByRobot.set(run.robotId, run.id);
    }
  }

  async listRuns(options: { robotId?: string; status?: string; limit?: number }) {
    const prisma = this.prisma as any;
    const where: Record<string, unknown> = {};
    if (options.robotId) where['robotId'] = options.robotId;
    if (options.status) {
      const normalized = String(options.status).toLowerCase();
      if (normalized === 'active') {
        where['status'] = { in: ACTIVE_STATUSES };
      } else if (normalized === 'completed') {
        where['status'] = 'COMPLETED';
      } else if (normalized === 'failed') {
        where['status'] = { in: ['FAILED', 'UNKNOWN_TERMINATION'] };
      } else if (normalized === 'cancelled') {
        where['status'] = 'CANCELLED';
      }
    }

    const runs = await prisma.missionRun.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: Math.max(1, Math.min(options.limit ?? 50, 200)),
    });

    if (String(options.status ?? '').toLowerCase() !== 'active') {
      return runs;
    }

    const nowMs = Date.now();
    const filtered: typeof runs = [];
    for (const run of runs) {
      if (this.isStalePreviewRun(run, nowMs)) {
        await this.expirePreviewRun(run, new Date(nowMs));
        continue;
      }
      filtered.push(run);
    }
    return filtered;
  }

  async getCurrentRun(robotId: string) {
    const prisma = this.prisma as any;
    const activeId = this.activeRunIdsByRobot.get(robotId);
    if (activeId) {
      const byId = await prisma.missionRun.findUnique({ where: { id: activeId } });
      if (byId) {
        if (this.isStalePreviewRun(byId)) {
          await this.expirePreviewRun(byId);
        } else {
          return byId;
        }
      }
      this.activeRunIdsByRobot.delete(robotId);
    }

    const latest = await prisma.missionRun.findFirst({
      where: {
        robotId,
        status: { in: ACTIVE_STATUSES },
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (latest) {
      if (this.isStalePreviewRun(latest)) {
        await this.expirePreviewRun(latest);
        return null;
      }
      this.activeRunIdsByRobot.set(robotId, latest.id);
    }
    return latest;
  }

  private async findRunByRequest(robotId: string, requestId: string | undefined) {
    if (!requestId) return null;
    const prisma = this.prisma as any;
    return prisma.missionRun.findFirst({
      where: {
        robotId,
        requestIdLast: requestId,
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  private async findRunByRunId(robotId: string, runId: string | undefined) {
    if (!runId) return null;
    const prisma = this.prisma as any;
    return prisma.missionRun.findFirst({
      where: {
        robotId,
        runId,
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async recordCommandIntent(meta: RobotMissionMeta, event: string, payload: any) {
    if (event !== 'SHOW_UP' && event !== 'START_MISSION') return;

    const prisma = this.prisma as any;
    const missionId = normalizeMissionId(payload?.missionId ?? payload?.missionID);
    const requestId = normalizeRequestId(payload?.requestId);
    const current = await this.getCurrentRun(meta.robotId);
    const now = new Date();

    if (event === 'SHOW_UP') {
      if (current && ['RUNNING', 'PAUSED'].includes(current.status)) {
        this.log.warn(
          { robotId: meta.robotId, missionId, currentStatus: current.status },
          'Ignoring SHOW_UP intent while mission run is already active'
        );
        return null;
      }

      const missionNameSnapshot = await this.resolveMissionName(meta.mapId, missionId);
      const data = {
        robotId: meta.robotId,
        robotNameSnapshot: meta.robotName,
        missionId,
        missionNameSnapshot,
        mapId: meta.mapId ?? undefined,
        status: 'PREVIEW_PENDING' as MissionRunStatus,
        phase: 'PREVIEW_PENDING' as MissionRunStatus,
        requestIdLast: requestId,
        runId: undefined,
        waypointIndex: undefined,
        totalWaypoints: undefined,
        lastMessage: 'SHOW_UP sent',
        lastEvent: event,
        lastEventAt: now,
      };

      try {
        if (current && PREVIEW_STATUSES.includes(current.status)) {
          const updated = await prisma.missionRun.update({
            where: { id: current.id },
            data,
          });
          this.activeRunIdsByRobot.set(meta.robotId, updated.id);
          return updated;
        }

        if (current) {
          this.log.warn(
            { robotId: meta.robotId, missionId, currentStatus: current.status },
            'Ignoring SHOW_UP intent because another run already exists for robot'
          );
          return null;
        }

        const created = await prisma.missionRun.create({ data });
        this.activeRunIdsByRobot.set(meta.robotId, created.id);
        return created;
      } catch (error) {
        this.log.error({ robotId: meta.robotId, event, error }, 'Failed to record mission intent');
        return null;
      }
    }

    if (event === 'START_MISSION' && current) {
      if (!PREVIEW_STATUSES.includes(current.status)) {
        this.log.warn(
          { robotId: meta.robotId, missionId, currentStatus: current.status },
          'Ignoring START_MISSION intent without a previewable current run'
        );
        return null;
      }

      try {
        return await prisma.missionRun.update({
          where: { id: current.id },
          data: {
            status: 'START_PENDING',
            phase: 'START_PENDING',
            requestIdLast: requestId,
            lastMessage: 'START_MISSION sent',
            lastEvent: event,
            lastEventAt: now,
          },
        });
      } catch (error) {
        this.log.error({ robotId: meta.robotId, event, error }, 'Failed to persist start intent');
      }
    }

    return null;
  }

  async applyEvent(meta: RobotMissionMeta, event: string, payload: any) {
    const prisma = this.prisma as any;
    const current = await this.getCurrentRun(meta.robotId);
    const missionId = normalizeMissionId(payload?.missionId ?? payload?.missionID);
    const requestId = normalizeRequestId(payload?.requestId);
    const runId = normalizeRequestId(payload?.runId);
    const appliedAt = new Date(eventTimestamp(event, payload));

    try {
      if (event === 'MISSION_CONTROL_ACK') {
        const targetRun =
          current?.requestIdLast === requestId
            ? current
            : ((await this.findRunByRequest(meta.robotId, requestId)) ?? current);
        const requestType = String(payload?.requestType ?? '').toUpperCase();
        const isSuccess = payload?.status === 'success';
        if (requestId && targetRun?.requestIdLast && requestId !== targetRun.requestIdLast) {
          return null;
        }
        if (!targetRun && requestType !== 'SHOW_UP') return null;

        if (requestType === 'SHOW_UP') {
          const baseId = targetRun?.id;
          const missionNameSnapshot = await this.resolveMissionName(meta.mapId, missionId);
          const data = {
            robotId: meta.robotId,
            robotNameSnapshot: meta.robotName,
            missionId,
            missionNameSnapshot,
            mapId: meta.mapId ?? undefined,
            status: isSuccess ? 'SHOWING' : 'FAILED',
            phase: isSuccess ? 'SHOWING' : 'FAILED',
            requestIdLast: requestId,
            lastMessage: payload?.message ?? null,
            lastEvent: event,
            lastEventAt: appliedAt,
          };
          const run = baseId
            ? await prisma.missionRun.update({ where: { id: baseId }, data })
            : await prisma.missionRun.create({ data });
          if (isSuccess) {
            this.activeRunIdsByRobot.set(meta.robotId, run.id);
          } else {
            this.activeRunIdsByRobot.delete(meta.robotId);
          }
          return run;
        }

        if (!targetRun) return null;
        if (requestType === 'PAUSE') {
          return prisma.missionRun.update({
            where: { id: targetRun.id },
            data: {
              status: isSuccess ? 'PAUSED' : targetRun.status,
              phase: isSuccess ? 'PAUSED' : targetRun.phase,
              requestIdLast: requestId,
              lastMessage: payload?.message ?? null,
              lastEvent: event,
              lastEventAt: appliedAt,
            },
          });
        }
        if (requestType === 'RESUME') {
          return prisma.missionRun.update({
            where: { id: targetRun.id },
            data: {
              status: isSuccess ? 'RUNNING' : targetRun.status,
              phase: isSuccess ? 'RUNNING' : targetRun.phase,
              requestIdLast: requestId,
              lastMessage: payload?.message ?? null,
              lastEvent: event,
              lastEventAt: appliedAt,
            },
          });
        }
        if (requestType === 'CANCEL') {
          const run = await prisma.missionRun.update({
            where: { id: targetRun.id },
            data: {
              status: isSuccess ? 'CANCELLED' : targetRun.status,
              phase: isSuccess ? 'CANCELLED' : targetRun.phase,
              requestIdLast: requestId,
              endedAt: isSuccess ? appliedAt : targetRun.endedAt,
              durationMs:
                isSuccess && targetRun.startedAt
                  ? Math.max(0, appliedAt.getTime() - new Date(targetRun.startedAt).getTime())
                  : targetRun.durationMs,
              lastMessage: payload?.message ?? null,
              lastEvent: event,
              lastEventAt: appliedAt,
            },
          });
          if (isSuccess) this.activeRunIdsByRobot.delete(meta.robotId);
          return run;
        }
        return null;
      }

      if (event === 'MISSION_START_ACK') {
        const targetRun =
          current?.requestIdLast === requestId
            ? current
            : ((await this.findRunByRequest(meta.robotId, requestId)) ?? current);
        if (requestId && targetRun?.requestIdLast && requestId !== targetRun.requestIdLast) {
          return null;
        }
        if (!targetRun) return null;
        const isSuccess = payload?.status === 'success';
        return prisma.missionRun.update({
          where: { id: targetRun.id },
          data: {
            status: isSuccess ? 'RUNNING' : 'SHOWING',
            phase: isSuccess ? 'RUNNING' : 'SHOWING',
            requestIdLast: requestId,
            runId: runId ?? targetRun.runId,
            startedAt: isSuccess
              ? new Date(timestampMs(payload?.startedAt) ?? appliedAt.getTime())
              : targetRun.startedAt,
            waypointIndex: isSuccess ? 0 : targetRun.waypointIndex,
            lastMessage: payload?.message ?? null,
            lastEvent: event,
            lastEventAt: appliedAt,
          },
        });
      }

      if (event === 'WAYPOINT_ACK') {
        const targetRun =
          current?.runId === runId
            ? current
            : ((await this.findRunByRunId(meta.robotId, runId)) ?? current);
        if (runId && targetRun?.runId && runId !== targetRun.runId) {
          return null;
        }
        if (!targetRun) return null;
        return prisma.missionRun.update({
          where: { id: targetRun.id },
          data: {
            runId: runId ?? targetRun.runId,
            waypointIndex:
              typeof payload?.waypointIndex === 'number'
                ? payload.waypointIndex
                : targetRun.waypointIndex,
            totalWaypoints:
              typeof payload?.totalWaypoints === 'number'
                ? payload.totalWaypoints
                : targetRun.totalWaypoints,
            lastMessage: payload?.message ?? null,
            lastEvent: event,
            lastEventAt: appliedAt,
          },
        });
      }

      if (event === 'MISSION_COMPLETED') {
        const targetRun =
          current?.runId === runId
            ? current
            : ((await this.findRunByRunId(meta.robotId, runId)) ?? current);
        if (runId && targetRun?.runId && runId !== targetRun.runId) {
          return null;
        }
        if (!targetRun) return null;
        const rawStatus = String(payload?.status ?? '').toLowerCase();
        const finalStatus: MissionRunStatus =
          rawStatus === 'success'
            ? 'COMPLETED'
            : rawStatus === 'cancelled'
              ? 'CANCELLED'
              : 'FAILED';
        const run = await prisma.missionRun.update({
          where: { id: targetRun.id },
          data: {
            runId: runId ?? targetRun.runId,
            status: finalStatus,
            phase: finalStatus,
            endedAt: appliedAt,
            durationMs: targetRun.startedAt
              ? Math.max(0, appliedAt.getTime() - new Date(targetRun.startedAt).getTime())
              : targetRun.durationMs,
            lastMessage: payload?.message ?? null,
            lastEvent: event,
            lastEventAt: appliedAt,
          },
        });
        if (this.activeRunIdsByRobot.get(meta.robotId) === targetRun.id) {
          this.activeRunIdsByRobot.delete(meta.robotId);
        }
        return run;
      }

      if (event === 'ROBOT_STATUS_UPDATE') {
        const runtimeStatus = String(payload?.mission?.status ?? '').toUpperCase();
        const runtimeMissionId = normalizeMissionId(payload?.mission?.currentMissionId);
        const runtimeRunId = normalizeRequestId(payload?.mission?.runId);
        const runtimeStartedAt = timestampMs(payload?.mission?.startedAt);
        const currentWaypointIndex =
          typeof payload?.mission?.currentWaypointIndex === 'number'
            ? payload.mission.currentWaypointIndex
            : undefined;
        const totalWaypoints =
          typeof payload?.mission?.totalWaypoints === 'number'
            ? payload.mission.totalWaypoints
            : undefined;

        if (runtimeStatus === 'IDLE' && !runtimeMissionId) {
          if (current && ACTIVE_STATUSES.includes(current.status)) {
            const closed = await prisma.missionRun.update({
              where: { id: current.id },
              data: {
                status: 'UNKNOWN_TERMINATION',
                phase: 'UNKNOWN_TERMINATION',
                endedAt: appliedAt,
                durationMs: current.startedAt
                  ? Math.max(0, appliedAt.getTime() - new Date(current.startedAt).getTime())
                  : current.durationMs,
                lastMessage:
                  current.lastMessage ??
                  'Mission ended without a terminal event; runtime reported idle',
                lastEvent: event,
                lastEventAt: appliedAt,
              },
            });
            this.activeRunIdsByRobot.delete(meta.robotId);
            return closed;
          }
          return current;
        }

        if (!current && runtimeMissionId) {
          const missionNameSnapshot = await this.resolveMissionName(meta.mapId, runtimeMissionId);
          const phase: MissionRunStatus = runtimeStatus === 'PAUSED' ? 'PAUSED' : 'RUNNING';
          const created = await prisma.missionRun.create({
            data: {
              robotId: meta.robotId,
              robotNameSnapshot: meta.robotName,
              missionId: runtimeMissionId,
              missionNameSnapshot,
              mapId: meta.mapId ?? undefined,
              runId: runtimeRunId,
              status: phase,
              phase,
              startedAt: runtimeStartedAt ? new Date(runtimeStartedAt) : undefined,
              waypointIndex: currentWaypointIndex,
              totalWaypoints,
              lastEvent: event,
              lastEventAt: appliedAt,
            },
          });
          this.activeRunIdsByRobot.set(meta.robotId, created.id);
          return created;
        }

        if (!current) return null;
        if (!runtimeMissionId) return current;

        const phase: MissionRunStatus =
          runtimeStatus === 'PAUSED'
            ? 'PAUSED'
            : runtimeStatus === 'ACTIVE'
              ? 'RUNNING'
              : current.phase;

        return prisma.missionRun.update({
          where: { id: current.id },
          data: {
            missionId: runtimeMissionId,
            runId: runtimeRunId ?? current.runId,
            status: phase,
            phase,
            startedAt: runtimeStartedAt ? new Date(runtimeStartedAt) : current.startedAt,
            waypointIndex: currentWaypointIndex ?? current.waypointIndex,
            totalWaypoints: totalWaypoints ?? current.totalWaypoints,
            lastEvent: event,
            lastEventAt: appliedAt,
          },
        });
      }
    } catch (error) {
      this.log.error({ robotId: meta.robotId, event, error }, 'Failed to persist mission event');
    }

    return null;
  }

  private async resolveMissionName(
    mapId: string | null | undefined,
    missionId: string | undefined
  ) {
    if (!mapId || !missionId) return null;

    try {
      const prisma = this.prisma as any;
      const map = await prisma.map.findUnique({
        where: { id: mapId },
        select: { features: true },
      });
      const missions = Array.isArray(map?.features?.missions) ? map.features.missions : [];
      const match = missions.find(
        (mission: any) => String(mission?.id ?? mission?.missionId) === missionId
      );
      const name = typeof match?.name === 'string' ? match.name.trim() : '';
      return name.length ? name : null;
    } catch (error) {
      this.log.warn({ mapId, missionId, error }, 'Failed to resolve mission name snapshot');
      return null;
    }
  }
}
