import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const LAST_SEEN_STALE_MS = 90_000;
const BATTERY_EPSILON = 0.01;
const isEmergencyStatus = (value: unknown) => value === 'SW_EMERGENCY' || value === 'HW_EMERGENCY';

const statusUpdateSchema = z.object({
  robotId: z.union([z.string(), z.number(), z.null()]).optional(),
  timestamp: z.string().optional(),
  mode: z.enum(['teleop', 'autonomous']),
  batteryPercentage: z.number().nullable().optional(),
  chargingStatus: z.string().nullable().optional(),
  mission: z
    .object({
      status: z.enum(['ACTIVE', 'PAUSED', 'IDLE']).optional(),
      currentMissionId: z.union([z.string(), z.number(), z.null()]).optional(),
    })
    .optional(),
});

type SyncDeps = {
  prisma: PrismaClient;
  log: {
    error: (obj: Record<string, unknown>, msg: string) => void;
  };
  rememberNonEmergencyStatus?: (robotId: string, status: 'TELEOP' | 'AUTONOMOUS') => void;
};

export type SyncResult = {
  ok: boolean;
  updated: boolean;
  reason?: string;
};

const normalizeBattery = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
};

const hasBatteryChanged = (current: unknown, next: number) => {
  if (typeof current !== 'number' || !Number.isFinite(current)) return true;
  return Math.abs(current - next) >= BATTERY_EPSILON;
};

export const parseRobotStatusUpdatePayload = (
  payload: unknown
): { ok: true; value: z.infer<typeof statusUpdateSchema> } | { ok: false; reason: string } => {
  const parsed = statusUpdateSchema.safeParse(payload);
  if (!parsed.success) {
    const reason =
      parsed.error.issues
        .slice(0, 3)
        .map(issue => `${issue.path.join('.') || 'payload'}: ${issue.message}`)
        .join('; ') || 'invalid_payload';
    return { ok: false, reason };
  }
  return { ok: true, value: parsed.data };
};

export const syncRobotStatusUpdate = async (
  deps: SyncDeps,
  robotId: string,
  payload: unknown
): Promise<SyncResult> => {
  const parsed = parseRobotStatusUpdatePayload(payload);
  if (!parsed.ok) {
    return {
      ok: false,
      updated: false,
      reason: parsed.reason,
    };
  }

  const prisma = deps.prisma as any;
  const robot = await prisma.robot.findUnique({
    where: { id: robotId },
    select: {
      battery: true,
      status: true,
      lastSeen: true,
    },
  });

  if (!robot) {
    return { ok: false, updated: false, reason: 'robot_not_found' };
  }

  const updateData: Record<string, unknown> = {};
  let hasFieldChange = false;

  const battery = normalizeBattery(parsed.value.batteryPercentage);
  if (battery !== null && hasBatteryChanged(robot.battery, battery)) {
    updateData['battery'] = battery;
    hasFieldChange = true;
  }

  if (
    parsed.value.mode === 'teleop' &&
    robot.status !== 'TELEOP' &&
    !isEmergencyStatus(robot.status)
  ) {
    updateData['status'] = 'TELEOP';
    hasFieldChange = true;
  }
  if (parsed.value.mode === 'teleop') {
    deps.rememberNonEmergencyStatus?.(robotId, 'TELEOP');
  }
  if (
    parsed.value.mode === 'autonomous' &&
    robot.status !== 'AUTONOMOUS' &&
    !isEmergencyStatus(robot.status)
  ) {
    updateData['status'] = 'AUTONOMOUS';
    hasFieldChange = true;
    deps.rememberNonEmergencyStatus?.(robotId, 'AUTONOMOUS');
  }

  const lastSeenMs = robot.lastSeen ? new Date(robot.lastSeen).getTime() : 0;
  const nowMs = Date.now();
  const isLastSeenStale = !Number.isFinite(lastSeenMs) || nowMs - lastSeenMs > LAST_SEEN_STALE_MS;

  if (hasFieldChange || isLastSeenStale) {
    updateData['lastSeen'] = new Date(nowMs);
  }

  if (Object.keys(updateData).length === 0) {
    return { ok: true, updated: false };
  }

  try {
    await prisma.robot.update({
      where: { id: robotId },
      data: updateData,
    });
    return { ok: true, updated: true };
  } catch (error) {
    deps.log.error({ robotId, error }, 'Failed to sync ROBOT_STATUS_UPDATE to robot record');
    return { ok: false, updated: false, reason: 'db_update_failed' };
  }
};
