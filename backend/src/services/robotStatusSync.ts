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
  // Map stem the robot reports it is currently localized on (auto-follow signal).
  currentMap: z.string().nullable().optional(),
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

const stemToFilenames = (stem: string) => {
  const base = stem.replace(/\.ya?ml$/i, '');
  return [`${base}.yaml`, `${base}.yml`, base];
};

// Auto-follow: pick the robot's active map from the status update without clobbering
// a manual pin. Primary signal is `currentMap` (the loaded map stem); the fallback
// resolves the current mission to the map whose metadata contains it.
const resolveActiveMapFromStatus = async (
  deps: SyncDeps,
  robotId: string,
  currentMap: string | null | undefined,
  currentMissionId: string | number | null | undefined
) => {
  const prisma = deps.prisma as any;
  try {
    const rows = await prisma.robotMap.findMany({
      where: { robotId },
      include: { map: { select: { id: true, filename: true, features: true } } },
    });
    if (rows.length === 0) return;
    if (rows.some((row: any) => row.isPinned)) return;

    let targetMapId: string | null = null;

    if (currentMap) {
      const candidates = stemToFilenames(currentMap);
      const match = rows.find((row: any) => candidates.includes(row.map?.filename));
      targetMapId = match?.mapId ?? null;
    }

    if (!targetMapId && currentMissionId != null && currentMissionId !== '') {
      const missionKey = String(currentMissionId);
      const match = rows.find((row: any) => {
        const missions = row.map?.features?.missions;
        return Array.isArray(missions) && missions.some((m: any) => String(m?.id) === missionKey);
      });
      targetMapId = match?.mapId ?? null;
    }

    if (!targetMapId) return;
    const active = rows.find((row: any) => row.isActive);
    if (active?.mapId === targetMapId) return;

    await prisma.$transaction([
      prisma.robotMap.updateMany({ where: { robotId }, data: { isActive: false } }),
      prisma.robotMap.update({
        where: { robotId_mapId: { robotId, mapId: targetMapId } },
        data: { isActive: true },
      }),
      prisma.robot.update({ where: { id: robotId }, data: { mapId: targetMapId } }),
    ]);
  } catch (error) {
    deps.log.error({ robotId, error }, 'Failed to resolve active map from ROBOT_STATUS_UPDATE');
  }
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

  // Auto-follow the robot's reported map (independent of the field updates below).
  await resolveActiveMapFromStatus(
    deps,
    robotId,
    parsed.value.currentMap,
    parsed.value.mission?.currentMissionId
  );

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
