import {
  applyMissionEvent,
  applyMissionIntent,
  isMissionActivePhase,
  isPreviewLikePhase,
  isRobotMissionStatusEvent,
  type MissionPhase,
  type MissionStatus,
} from '@tensrai/shared';
import { create } from 'zustand';
import { createRobotMappingWsClient } from '@/services/robotMappingWsClient';
import type { Robot } from '@/types/robot';

export type MissionCommandDispatchResult = {
  accepted: boolean;
  queued: boolean;
  reason?: string;
};

type MissionState = {
  statusByRobot: Record<string, MissionStatus>;
  connect: (robotId: string) => void;
  disconnect: (robotId: string) => void;
  sendEvent: (
    robotId: string,
    event: string,
    payload?: Record<string, unknown>
  ) => MissionCommandDispatchResult;
  hydrateFromRobots: (robots: Robot[]) => void;
};

const clients = new Map<string, ReturnType<typeof createRobotMappingWsClient>>();
// A command that never reached the server must not block merges for good.
const COMMAND_SYNC_WINDOW_MS = 30_000;
const IDLE: MissionStatus = { status: 'idle', phase: 'idle' };

// Merges what the server reports into local state. Undefined means the report is older than what
// this client already knows, so it should be ignored.
const hydrateStatus = (
  existing: MissionStatus | undefined,
  mission: NonNullable<Robot['mission']>
): MissionStatus | undefined => {
  const parsedUpdatedAt = mission.updatedAt ? Date.parse(mission.updatedAt) : undefined;
  // Compared like with like, because the robot, the server and this browser keep different clocks:
  // robot events and reports by the robot's clock, and this client's latest command by its id.
  const isOlder = (incoming: number | undefined, local: number | undefined) =>
    incoming !== undefined && local !== undefined && incoming < local;
  const awaitingOwnCommand =
    existing?.lastCommandAt !== undefined &&
    Date.now() - existing.lastCommandAt < COMMAND_SYNC_WINDOW_MS &&
    mission.requestIdLast !== existing.requestIdLast;
  if (
    existing &&
    (awaitingOwnCommand ||
      isOlder(mission.lastEventAt, existing.lastEventAt) ||
      isOlder(mission.lastSeenTs, existing.lastSeenTs))
  ) {
    return undefined;
  }

  const incomingPhase =
    (mission.phase as MissionPhase) ??
    (mission.status as MissionPhase) ??
    existing?.phase ??
    'idle';
  const preserveLocalPreview =
    isPreviewLikePhase(existing?.phase) &&
    incomingPhase === 'idle' &&
    !mission.currentMissionId &&
    !mission.runId;
  const resolvedPhase = preserveLocalPreview ? (existing?.phase ?? incomingPhase) : incomingPhase;
  const keepWaypoint = isMissionActivePhase(resolvedPhase);
  // An idle report can't describe a preview this client just asked for, so it can't overwrite it.
  const runFields: Partial<typeof mission> = preserveLocalPreview ? {} : mission;

  return {
    ...existing,
    status: resolvedPhase,
    phase: resolvedPhase,
    currentMissionId: runFields.currentMissionId ?? existing?.currentMissionId,
    requestIdLast: runFields.requestIdLast ?? existing?.requestIdLast,
    runId: runFields.runId ?? existing?.runId,
    startedAt: runFields.startedAt ?? existing?.startedAt,
    message: runFields.message ?? existing?.message,
    lastEvent: runFields.lastEvent ?? existing?.lastEvent,
    updatedAt: Number.isFinite(parsedUpdatedAt) ? parsedUpdatedAt : existing?.updatedAt,
    lastEventStatus: runFields.lastEventStatus ?? existing?.lastEventStatus,
    lastRequestType: runFields.lastRequestType ?? existing?.lastRequestType,
    mode: mission.mode ?? existing?.mode,
    batteryPercentage:
      mission.batteryPercentage !== undefined
        ? mission.batteryPercentage
        : existing?.batteryPercentage,
    chargingStatus:
      mission.chargingStatus !== undefined ? mission.chargingStatus : existing?.chargingStatus,
    lastSeenTs: mission.lastSeenTs ?? existing?.lastSeenTs,
    waypointIndex: keepWaypoint ? (mission.waypointIndex ?? existing?.waypointIndex) : undefined,
    totalWaypoints: keepWaypoint ? (mission.totalWaypoints ?? existing?.totalWaypoints) : undefined,
    runtimeUpdatedAt: mission.lastSeenTs ?? existing?.runtimeUpdatedAt,
    modeUpdatedAt:
      mission.lastSeenTs !== undefined && mission.mode !== undefined
        ? mission.lastSeenTs
        : existing?.modeUpdatedAt,
  };
};

export const useRobotMissionStore = create<MissionState>(set => ({
  statusByRobot: {},

  connect: (robotId: string) => {
    if (!robotId || clients.has(robotId)) return;

    const client = createRobotMappingWsClient(robotId);
    clients.set(robotId, client);

    client.addEventListener(event => {
      if (!isRobotMissionStatusEvent(event.event)) return;
      set(state => {
        const current = state.statusByRobot[robotId] ?? IDLE;
        const next = applyMissionEvent(current, event, Date.now());
        return {
          statusByRobot: {
            ...state.statusByRobot,
            [robotId]: next,
          },
        };
      });
    });

    client.connect();
  },

  disconnect: (robotId: string) => {
    const client = clients.get(robotId);
    if (!client) return;
    client.disconnect();
    clients.delete(robotId);
  },

  sendEvent: (
    robotId: string,
    event: string,
    payload: Record<string, unknown> = {}
  ): MissionCommandDispatchResult => {
    if (!robotId) return { accepted: false, queued: false, reason: 'missing_robot_id' };

    if (!clients.has(robotId)) {
      const client = createRobotMappingWsClient(robotId);
      clients.set(robotId, client);
      client.connect();
    }

    const client = clients.get(robotId);
    if (!client) {
      return { accepted: false, queued: false, reason: 'client_unavailable' };
    }

    const result = client.sendEvent(event, payload);
    if (result.accepted) {
      set(state => {
        const current = state.statusByRobot[robotId] ?? IDLE;
        return {
          statusByRobot: {
            ...state.statusByRobot,
            [robotId]: applyMissionIntent(current, event, payload, Date.now(), result.commandId),
          },
        };
      });
    }

    return result;
  },

  hydrateFromRobots: (robots: Robot[]) => {
    if (!Array.isArray(robots) || robots.length === 0) return;

    set(state => {
      let changed = false;
      const next = { ...state.statusByRobot };

      for (const robot of robots) {
        if (!robot?.id || !robot.mission) continue;

        const existing = state.statusByRobot[robot.id];
        const nextStatus = hydrateStatus(existing, robot.mission);
        if (!nextStatus || JSON.stringify(existing ?? {}) === JSON.stringify(nextStatus)) continue;
        next[robot.id] = nextStatus;
        changed = true;
      }

      if (!changed) return state;
      return { statusByRobot: next };
    });
  },
}));
