import type { MissionRun, MissionRunStatus, PrismaClient } from '@prisma/client';
import { normalizeMissionId, normalizeRequestId, normalizeRequestType } from '@tensrai/shared';

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

type RuntimeMissionReport = {
  status?: unknown;
  currentMissionId?: unknown;
  runId?: unknown;
  startedAt?: unknown;
  currentWaypointIndex?: unknown;
  totalWaypoints?: unknown;
};

type MissionEventPayload =
  | {
      requestType?: unknown;
      status?: unknown;
      message?: unknown;
      startedAt?: unknown;
      waypointIndex?: unknown;
      totalWaypoints?: unknown;
      mission?: RuntimeMissionReport | null;
    }
  | null
  | undefined;

type MissionEventContext = {
  meta: RobotMissionMeta;
  event: string;
  payload: MissionEventPayload;
  current: MissionRun | null;
  missionId: string | undefined;
  requestId: string | undefined;
  runId: string | undefined;
  appliedAt: Date;
};

type CommandIntent = {
  meta: RobotMissionMeta;
  event: string;
  missionId: string | undefined;
  requestId: string | undefined;
  now: Date;
};

// Writes pass explicit undefined for fields they leave unset, which Prisma's generated input types
// reject under exactOptionalPropertyTypes.
type MissionRunWrites = {
  create(args: { data: Record<string, unknown> }): Promise<MissionRun>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<MissionRun>;
};

const runStatusFilter = (status: string) => {
  switch (status.toLowerCase()) {
    case 'active':
      return { in: ACTIVE_STATUSES };
    case 'completed':
      return 'COMPLETED';
    case 'failed':
      return { in: ['FAILED', 'UNKNOWN_TERMINATION'] };
    case 'cancelled':
      return 'CANCELLED';
    default:
      return undefined;
  }
};

const durationUntil = (run: MissionRun, endedAt: Date) =>
  run.startedAt
    ? Math.max(0, endedAt.getTime() - new Date(run.startedAt).getTime())
    : run.durationMs;

const readRuntimeReport = (mission: RuntimeMissionReport | null | undefined) => ({
  runtimeStatus: String(mission?.status ?? '').toUpperCase(),
  runtimeMissionId: normalizeMissionId(mission?.currentMissionId),
  runtimeRunId: normalizeRequestId(mission?.runId),
  runtimeStartedAt: timestampMs(mission?.startedAt),
  currentWaypointIndex:
    typeof mission?.currentWaypointIndex === 'number' ? mission.currentWaypointIndex : undefined,
  totalWaypoints: typeof mission?.totalWaypoints === 'number' ? mission.totalWaypoints : undefined,
});

type RuntimeReport = ReturnType<typeof readRuntimeReport>;

export class MissionRunStore {
  private prisma: PrismaClient;
  private log: LoggerLike;
  private activeRunIdsByRobot = new Map<string, string>();

  constructor(prisma: PrismaClient, log: LoggerLike) {
    this.prisma = prisma;
    this.log = log;
  }

  private get missionRuns() {
    return this.prisma.missionRun as unknown as MissionRunWrites;
  }

  private isStalePreviewRun(run: any, nowMs = Date.now()) {
    if (!run || !PREVIEW_STATUSES.includes(run.status)) return false;
    // updatedAt is the server's clock, like nowMs; lastEventAt can carry the robot's.
    const ts =
      (run.updatedAt ? new Date(run.updatedAt).getTime() : undefined) ??
      (run.lastEventAt ? new Date(run.lastEventAt).getTime() : undefined);
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

  private async orgIdOf(robotId: string): Promise<string> {
    const robot = await (this.prisma as any).robot.findUnique({
      where: { id: robotId },
      select: { orgId: true },
    });
    if (!robot) throw new Error(`Robot ${robotId} not found`);
    return robot.orgId;
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

  async listRuns(options: { orgId?: string; robotId?: string; status?: string; limit?: number }) {
    const prisma = this.prisma as any;
    const where: Record<string, unknown> = {};
    if (options.orgId) where['orgId'] = options.orgId;
    if (options.robotId) where['robotId'] = options.robotId;
    if (options.status) {
      const statusFilter = runStatusFilter(String(options.status));
      if (statusFilter) where['status'] = statusFilter;
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

  // Only a run still in progress can take a control ack: the robot reuses ids such as
  // EMERGENCY_AUTO_RESUME on every run, and matching a finished run would reopen it.
  private async findRunByRequest(robotId: string, requestId: string | undefined) {
    if (!requestId) return null;
    const prisma = this.prisma as any;
    return prisma.missionRun.findFirst({
      where: {
        robotId,
        requestIdLast: requestId,
        status: { in: ACTIVE_STATUSES },
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

    const missionId = normalizeMissionId(payload?.missionId ?? payload?.missionID);
    const requestId = normalizeRequestId(payload?.requestId);
    const current: MissionRun | null = await this.getCurrentRun(meta.robotId);
    const intent: CommandIntent = { meta, event, missionId, requestId, now: new Date() };

    if (event === 'SHOW_UP') return this.recordPreviewIntent(intent, current);
    if (!current) return null;
    return this.recordStartIntent(intent, current);
  }

  private async recordPreviewIntent(intent: CommandIntent, current: MissionRun | null) {
    const { meta, event, missionId, requestId, now } = intent;
    if (current && ['RUNNING', 'PAUSED'].includes(current.status)) {
      this.log.warn(
        { robotId: meta.robotId, missionId, currentStatus: current.status },
        'Ignoring SHOW_UP intent while mission run is already active'
      );
      return null;
    }

    const data = {
      robotId: meta.robotId,
      robotNameSnapshot: meta.robotName,
      missionId,
      ...(await this.missionSnapshot(meta.robotId, missionId)),
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
        const updated = await this.missionRuns.update({
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

      const created = await this.missionRuns.create({
        data: { ...data, orgId: await this.orgIdOf(meta.robotId) },
      });
      this.activeRunIdsByRobot.set(meta.robotId, created.id);
      return created;
    } catch (error) {
      this.log.error({ robotId: meta.robotId, event, error }, 'Failed to record mission intent');
      return null;
    }
  }

  private async recordStartIntent(intent: CommandIntent, current: MissionRun) {
    const { meta, event, missionId, requestId, now } = intent;
    if (!PREVIEW_STATUSES.includes(current.status)) {
      this.log.warn(
        { robotId: meta.robotId, missionId, currentStatus: current.status },
        'Ignoring START_MISSION intent without a previewable current run'
      );
      return null;
    }

    try {
      return await this.missionRuns.update({
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

    return null;
  }

  async applyEvent(meta: RobotMissionMeta, event: string, payload: any) {
    const current: MissionRun | null = await this.getCurrentRun(meta.robotId);
    const context: MissionEventContext = {
      meta,
      event,
      payload,
      current,
      missionId: normalizeMissionId(payload?.missionId ?? payload?.missionID),
      requestId: normalizeRequestId(payload?.requestId),
      runId: normalizeRequestId(payload?.runId),
      appliedAt: new Date(eventTimestamp(event, payload)),
    };

    switch (event) {
      case 'MISSION_CONTROL_ACK':
        return this.applyControlAck(context);
      case 'MISSION_START_ACK':
        return this.applyStartAck(context);
      case 'WAYPOINT_ACK':
        return this.applyWaypointAck(context);
      case 'MISSION_COMPLETED':
        return this.applyCompletion(context);
      case 'ROBOT_STATUS_UPDATE':
        return this.applyStatusUpdate(context);
      default:
        return null;
    }
  }

  // Each event handler logs and drops a failed lookup or awaited write. A write it returns without
  // awaiting rejects to the caller instead.
  private eventNotPersisted({ meta, event }: MissionEventContext, error: unknown) {
    this.log.error({ robotId: meta.robotId, event, error }, 'Failed to persist mission event');
    return null;
  }

  private async runForRequest({
    meta,
    current,
    requestId,
  }: MissionEventContext): Promise<MissionRun | null> {
    return current?.requestIdLast === requestId
      ? current
      : ((await this.findRunByRequest(meta.robotId, requestId)) ?? current);
  }

  private async runForRunId({
    meta,
    current,
    runId,
  }: MissionEventContext): Promise<MissionRun | null> {
    return current?.runId === runId
      ? current
      : ((await this.findRunByRunId(meta.robotId, runId)) ?? current);
  }

  private async applyControlAck(context: MissionEventContext) {
    const { payload, requestId } = context;
    try {
      const targetRun = await this.runForRequest(context);
      const requestType = normalizeRequestType(payload?.requestType);
      const isSuccess = payload?.status === 'success';
      // Only a preview can be superseded by a newer request. Pause, resume and cancel aren't recorded
      // as intents, so their ids never match the last one and must not be dropped for it.
      if (
        requestType === 'SHOW_UP' &&
        requestId &&
        targetRun?.requestIdLast &&
        requestId !== targetRun.requestIdLast
      ) {
        return null;
      }
      if (!targetRun && requestType !== 'SHOW_UP') return null;

      if (requestType === 'SHOW_UP') {
        return await this.applyPreviewAck(context, targetRun, isSuccess);
      }

      if (!targetRun) return null;
      return this.applyControlRequest(context, targetRun, requestType, isSuccess);
    } catch (error) {
      return this.eventNotPersisted(context, error);
    }
  }

  private async applyPreviewAck(
    context: MissionEventContext,
    targetRun: MissionRun | null,
    isSuccess: boolean
  ) {
    const { meta, event, payload, missionId, requestId, appliedAt } = context;
    const baseId = targetRun?.id;
    const data = {
      robotId: meta.robotId,
      robotNameSnapshot: meta.robotName,
      missionId,
      ...(await this.missionSnapshot(meta.robotId, missionId)),
      status: isSuccess ? 'SHOWING' : 'FAILED',
      phase: isSuccess ? 'SHOWING' : 'FAILED',
      requestIdLast: requestId,
      lastMessage: payload?.message ?? null,
      lastEvent: event,
      lastEventAt: appliedAt,
    };
    const run = baseId
      ? await this.missionRuns.update({ where: { id: baseId }, data })
      : await this.missionRuns.create({
          data: { ...data, orgId: await this.orgIdOf(meta.robotId) },
        });
    if (isSuccess) {
      this.activeRunIdsByRobot.set(meta.robotId, run.id);
    } else {
      this.activeRunIdsByRobot.delete(meta.robotId);
    }
    return run;
  }

  private applyControlRequest(
    { event, payload, requestId, appliedAt }: MissionEventContext,
    targetRun: MissionRun,
    requestType: string | undefined,
    isSuccess: boolean
  ) {
    if (requestType === 'PAUSE') {
      return this.missionRuns.update({
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
      return this.missionRuns.update({
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
      // "Cancel requested" isn't the end: MISSION_COMPLETED follows within the robot's 3s
      // watchdog. Closing the run here would let a status tick in that gap open a second one.
      return this.missionRuns.update({
        where: { id: targetRun.id },
        data: {
          requestIdLast: requestId,
          lastMessage: payload?.message ?? null,
          lastEvent: event,
          lastEventAt: appliedAt,
        },
      });
    }
    return null;
  }

  private async applyStartAck(context: MissionEventContext) {
    const { payload, missionId, requestId } = context;
    try {
      const targetRun = await this.runForRequest(context);
      if (requestId && targetRun?.requestIdLast && requestId !== targetRun.requestIdLast) {
        return null;
      }
      const isSuccess = payload?.status === 'success';
      if (!targetRun) {
        // A preview that expired, or no preview at all, must not lose the run: the status
        // tick that would otherwise create it can come after a short mission has finished.
        if (!isSuccess || !missionId) return null;
        return await this.createRunFromStartAck(context, missionId);
      }
      return this.updateRunFromStartAck(context, targetRun, isSuccess);
    } catch (error) {
      return this.eventNotPersisted(context, error);
    }
  }

  private async createRunFromStartAck(context: MissionEventContext, missionId: string) {
    const { meta, event, payload, requestId, runId, appliedAt } = context;
    const created = await this.missionRuns.create({
      data: {
        orgId: await this.orgIdOf(meta.robotId),
        robotId: meta.robotId,
        robotNameSnapshot: meta.robotName,
        missionId,
        ...(await this.missionSnapshot(meta.robotId, missionId)),
        runId,
        status: 'RUNNING',
        phase: 'RUNNING',
        requestIdLast: requestId,
        startedAt: new Date(timestampMs(payload?.startedAt) ?? appliedAt.getTime()),
        waypointIndex: 0,
        lastMessage: payload?.message ?? null,
        lastEvent: event,
        lastEventAt: appliedAt,
      },
    });
    this.activeRunIdsByRobot.set(meta.robotId, created.id);
    return created;
  }

  private updateRunFromStartAck(
    { event, payload, requestId, runId, appliedAt }: MissionEventContext,
    targetRun: MissionRun,
    isSuccess: boolean
  ) {
    // "Mission already running" is a refusal of the second start, not news about the first.
    const failedStatus = PREVIEW_STATUSES.includes(targetRun.status) ? 'SHOWING' : targetRun.status;
    return this.missionRuns.update({
      where: { id: targetRun.id },
      data: {
        status: isSuccess ? 'RUNNING' : failedStatus,
        phase: isSuccess ? 'RUNNING' : failedStatus,
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

  private async applyWaypointAck(context: MissionEventContext) {
    const { event, payload, runId, appliedAt } = context;
    try {
      const targetRun = await this.runForRunId(context);
      if (runId && targetRun?.runId && runId !== targetRun.runId) {
        return null;
      }
      if (!targetRun) return null;
      return this.missionRuns.update({
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
    } catch (error) {
      return this.eventNotPersisted(context, error);
    }
  }

  private async applyCompletion(context: MissionEventContext) {
    const { meta, event, payload, runId, appliedAt } = context;
    try {
      const targetRun = await this.runForRunId(context);
      if (runId && targetRun?.runId && runId !== targetRun.runId) {
        return null;
      }
      if (!targetRun) return null;
      const rawStatus = String(payload?.status ?? '').toLowerCase();
      const finalStatus: MissionRunStatus =
        rawStatus === 'success' ? 'COMPLETED' : rawStatus === 'cancelled' ? 'CANCELLED' : 'FAILED';
      const run = await this.missionRuns.update({
        where: { id: targetRun.id },
        data: {
          runId: runId ?? targetRun.runId,
          status: finalStatus,
          phase: finalStatus,
          endedAt: appliedAt,
          durationMs: durationUntil(targetRun, appliedAt),
          lastMessage: payload?.message ?? null,
          lastEvent: event,
          lastEventAt: appliedAt,
        },
      });
      if (this.activeRunIdsByRobot.get(meta.robotId) === targetRun.id) {
        this.activeRunIdsByRobot.delete(meta.robotId);
      }
      return run;
    } catch (error) {
      return this.eventNotPersisted(context, error);
    }
  }

  private async applyStatusUpdate(context: MissionEventContext) {
    const { current, payload } = context;
    try {
      const runtime = readRuntimeReport(payload?.mission);
      const { runtimeStatus, runtimeMissionId } = runtime;

      if (runtimeStatus === 'IDLE' && !runtimeMissionId) {
        // A robot reports IDLE throughout a preview, so previews end by expiry, not on this tick.
        return await this.closeIdleRun(context);
      }

      if (!current && runtimeMissionId) {
        return await this.createRunFromStatus(context, runtime, runtimeMissionId);
      }

      if (!current) return null;
      if (!runtimeMissionId) return current;
      return this.updateRunFromStatus(context, current, runtime, runtimeMissionId);
    } catch (error) {
      return this.eventNotPersisted(context, error);
    }
  }

  private async closeIdleRun({ meta, event, current, appliedAt }: MissionEventContext) {
    if (!current || !['RUNNING', 'PAUSED'].includes(current.status)) return current;
    const closed = await this.missionRuns.update({
      where: { id: current.id },
      data: {
        status: 'UNKNOWN_TERMINATION',
        phase: 'UNKNOWN_TERMINATION',
        endedAt: appliedAt,
        durationMs: durationUntil(current, appliedAt),
        lastMessage:
          current.lastMessage ?? 'Mission ended without a terminal event; runtime reported idle',
        lastEvent: event,
        lastEventAt: appliedAt,
      },
    });
    this.activeRunIdsByRobot.delete(meta.robotId);
    return closed;
  }

  private async createRunFromStatus(
    { meta, event, appliedAt }: MissionEventContext,
    runtime: RuntimeReport,
    missionId: string
  ) {
    const phase: MissionRunStatus = runtime.runtimeStatus === 'PAUSED' ? 'PAUSED' : 'RUNNING';
    const created = await this.missionRuns.create({
      data: {
        orgId: await this.orgIdOf(meta.robotId),
        robotId: meta.robotId,
        robotNameSnapshot: meta.robotName,
        missionId,
        ...(await this.missionSnapshot(meta.robotId, missionId)),
        runId: runtime.runtimeRunId,
        status: phase,
        phase,
        startedAt: runtime.runtimeStartedAt ? new Date(runtime.runtimeStartedAt) : undefined,
        waypointIndex: runtime.currentWaypointIndex,
        totalWaypoints: runtime.totalWaypoints,
        lastEvent: event,
        lastEventAt: appliedAt,
      },
    });
    this.activeRunIdsByRobot.set(meta.robotId, created.id);
    return created;
  }

  private updateRunFromStatus(
    { event, appliedAt }: MissionEventContext,
    current: MissionRun,
    runtime: RuntimeReport,
    missionId: string
  ) {
    const phase: MissionRunStatus =
      runtime.runtimeStatus === 'PAUSED'
        ? 'PAUSED'
        : runtime.runtimeStatus === 'ACTIVE'
          ? 'RUNNING'
          : current.phase;

    return this.missionRuns.update({
      where: { id: current.id },
      data: {
        missionId,
        runId: runtime.runtimeRunId ?? current.runId,
        status: phase,
        phase,
        startedAt: runtime.runtimeStartedAt
          ? new Date(runtime.runtimeStartedAt)
          : current.startedAt,
        waypointIndex: runtime.currentWaypointIndex ?? current.waypointIndex,
        totalWaypoints: runtime.totalWaypoints ?? current.totalWaypoints,
        lastEvent: event,
        lastEventAt: appliedAt,
      },
    });
  }

  // Read from the robot's maps at the time of the event: a map sync or auto-follow changes them
  // without the registry's copy of the robot finding out. A robot's mission can be on any of its
  // maps, and the robot loads that map to run it.
  private async missionSnapshot(robotId: string, missionId: string | undefined) {
    try {
      const rows = await (this.prisma as any).robotMap.findMany({
        where: { robotId },
        select: { mapId: true, isActive: true, map: { select: { features: true } } },
      });
      const active = rows.find((row: any) => row.isActive);
      for (const row of active ? [active, ...rows] : rows) {
        const missions = row.map?.features?.missions;
        const match = Array.isArray(missions)
          ? missions.find((mission: any) => String(mission?.id ?? mission?.missionId) === missionId)
          : undefined;
        if (match) {
          const name = typeof match.name === 'string' ? match.name.trim() : '';
          return { mapId: row.mapId, missionNameSnapshot: name || null };
        }
      }
      return { mapId: active?.mapId ?? undefined, missionNameSnapshot: null };
    } catch (error) {
      this.log.warn({ robotId, missionId, error }, 'Failed to resolve mission snapshot');
      return { missionNameSnapshot: null };
    }
  }
}
