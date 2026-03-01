import {
  isRobotMissionStatusEvent,
  isRobotRuntimeMode,
  type MissionCompletedPayload,
  type MissionControlAckPayload,
  type MissionStartAckPayload,
  type ModeChangeAckPayload,
  type RobotMissionEvent,
  type RobotStatusUpdatePayload,
  type WaypointAckPayload,
} from '@tensrai/shared';
import { create } from 'zustand';
import { createRobotMappingWsClient } from '@/services/robotMappingWsClient';
import type { Robot } from '@/types/robot';

export type MissionLifecycleStatus =
  | 'idle'
  | 'showing'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type MissionStatus = {
  status: MissionLifecycleStatus;
  currentMissionId?: string | undefined;
  message?: string | undefined;
  updatedAt?: number | undefined;
  lastEvent?: string | undefined;
  lastEventStatus?: string | undefined;
  lastRequestType?: string | undefined;
  lastEventAt?: number | undefined;
  lastEventMissionId?: string | undefined;
  mode?: 'teleop' | 'autonomous' | undefined;
  batteryPercentage?: number | null | undefined;
  chargingStatus?: string | null | undefined;
  lastSeenTs?: number | undefined;
  waypointIndex?: number | undefined;
  totalWaypoints?: number | undefined;
  runtimeUpdatedAt?: number | undefined;
  modeUpdatedAt?: number | undefined;
};

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

const normalizeMissionId = (value: unknown) => {
  if (value === null || value === undefined) return undefined;
  const str = String(value).trim();
  return str.length ? str : undefined;
};

const normalizeRequestType = (value: unknown) => {
  if (!value) return undefined;
  const raw = String(value).trim().toUpperCase();
  if (raw === 'PAUSE_MISSION' || raw === 'PAUSE') return 'PAUSE';
  if (raw === 'RESUME_MISSION' || raw === 'RESUME') return 'RESUME';
  if (raw === 'CANCEL_MISSION' || raw === 'CANCEL') return 'CANCEL';
  if (raw === 'SHOW_UP') return 'SHOW_UP';
  return raw;
};

const parseTimestampMs = (value: unknown): number | undefined => {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const resolveEventTimestamp = (event: string, payload: unknown): number => {
  const p = payload as any;
  if (event === 'ROBOT_STATUS_UPDATE') {
    return parseTimestampMs(p?.timestamp) ?? Date.now();
  }
  if (event === 'WAYPOINT_ACK') {
    return parseTimestampMs(p?.time) ?? Date.now();
  }
  if (event === 'MISSION_COMPLETED') {
    return parseTimestampMs(p?.completionTime) ?? Date.now();
  }
  return parseTimestampMs(p?.timestamp) ?? parseTimestampMs(p?.time) ?? Date.now();
};

const fromRuntimeMissionStatus = (value: unknown): MissionLifecycleStatus | undefined => {
  const status = String(value ?? '').toUpperCase();
  if (status === 'ACTIVE') return 'running';
  if (status === 'PAUSED') return 'paused';
  if (status === 'IDLE') return 'idle';
  return undefined;
};

const toFiniteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const shouldKeepWaypointProgress = (status: MissionLifecycleStatus | undefined) =>
  status === 'running' || status === 'paused' || status === 'showing';

const updateFromMissionStartAck = (
  current: MissionStatus,
  payload: MissionStartAckPayload | undefined,
  base: MissionStatus
): MissionStatus => {
  const missionId = normalizeMissionId(payload?.missionId);
  const ackStatus = payload?.status;
  const message = payload?.message ?? current.message;

  if (ackStatus === 'success') {
    return {
      ...base,
      status: 'running',
      currentMissionId: missionId,
      waypointIndex: 0,
      totalWaypoints: undefined,
      message,
      lastEventStatus: ackStatus,
    };
  }

  const lowerMessage = String(message ?? '').toLowerCase();
  if (
    lowerMessage.includes('already running') &&
    (current.status === 'running' || current.status === 'paused' || current.status === 'showing')
  ) {
    return {
      ...base,
      status: current.status,
      currentMissionId: current.currentMissionId ?? missionId,
      message,
      lastEventStatus: ackStatus,
    };
  }

  return {
    ...base,
    status: 'idle',
    currentMissionId: missionId,
    waypointIndex: undefined,
    totalWaypoints: undefined,
    message,
    lastEventStatus: ackStatus,
  };
};

const updateFromMissionControlAck = (
  current: MissionStatus,
  payload: MissionControlAckPayload | undefined,
  base: MissionStatus
): MissionStatus => {
  const requestType = normalizeRequestType(payload?.requestType);
  const missionId = normalizeMissionId(payload?.missionId);
  const ackStatus = payload?.status;
  const message = payload?.message ?? current.message;

  let status = current.status;
  if (ackStatus === 'success') {
    if (requestType === 'SHOW_UP') status = 'showing';
    if (requestType === 'PAUSE') status = 'paused';
    if (requestType === 'RESUME') status = 'running';
    if (requestType === 'CANCEL') status = 'cancelled';
  }

  const nextMissionId =
    ackStatus === 'success' && requestType === 'CANCEL'
      ? undefined
      : (missionId ?? current.currentMissionId);
  const clearWaypoint =
    (ackStatus === 'success' && requestType === 'SHOW_UP') ||
    (ackStatus === 'success' && requestType === 'CANCEL');

  return {
    ...base,
    status,
    currentMissionId: nextMissionId,
    waypointIndex: clearWaypoint ? undefined : current.waypointIndex,
    totalWaypoints: clearWaypoint ? undefined : current.totalWaypoints,
    message,
    lastEventStatus: ackStatus,
    lastRequestType: requestType,
  };
};

const updateFromMissionCompleted = (
  current: MissionStatus,
  payload: MissionCompletedPayload | undefined,
  base: MissionStatus
): MissionStatus => {
  const rawStatus = String(payload?.status ?? '').toLowerCase();
  const missionId = normalizeMissionId(payload?.missionId);
  const status: MissionLifecycleStatus =
    rawStatus === 'success' ? 'completed' : rawStatus === 'cancelled' ? 'cancelled' : 'failed';

  return {
    ...base,
    status,
    currentMissionId: missionId ?? current.currentMissionId,
    message: payload?.message ?? current.message,
    lastEventStatus: rawStatus || current.lastEventStatus,
  };
};

const updateFromWaypointAck = (
  current: MissionStatus,
  payload: WaypointAckPayload | undefined,
  base: MissionStatus
): MissionStatus => {
  return {
    ...base,
    currentMissionId: normalizeMissionId(payload?.missionId) ?? current.currentMissionId,
    waypointIndex: toFiniteNumber(payload?.waypointIndex) ?? current.waypointIndex,
    totalWaypoints: toFiniteNumber(payload?.totalWaypoints) ?? current.totalWaypoints,
    message: payload?.message ?? current.message,
    lastEventStatus: payload?.status ?? current.lastEventStatus,
  };
};

const updateFromModeChangeAck = (
  current: MissionStatus,
  payload: ModeChangeAckPayload | undefined,
  base: MissionStatus
): MissionStatus => {
  const modeTimestamp =
    parseTimestampMs(payload?.timestamp) ??
    parseTimestampMs(payload?.time) ??
    current.modeUpdatedAt;
  return {
    ...base,
    mode: isRobotRuntimeMode(payload?.currentMode) ? payload.currentMode : current.mode,
    modeUpdatedAt: modeTimestamp,
    message: payload?.message ?? payload?.error ?? current.message,
    lastEventStatus: payload?.status ?? current.lastEventStatus,
  };
};

const updateFromRobotStatusUpdate = (
  current: MissionStatus,
  payload: RobotStatusUpdatePayload | undefined,
  eventAt: number
): MissionStatus => {
  if (current.runtimeUpdatedAt !== undefined && eventAt < current.runtimeUpdatedAt) {
    return current;
  }

  const runtimeStatus = fromRuntimeMissionStatus(payload?.mission?.status);
  const missionId = normalizeMissionId(payload?.mission?.currentMissionId);
  const hasMissionId =
    payload?.mission !== undefined &&
    payload?.mission !== null &&
    Object.hasOwn(payload.mission, 'currentMissionId');
  const nextStatus = runtimeStatus ?? current.status;
  const nextMissionId = hasMissionId ? missionId : current.currentMissionId;
  const clearMissionId = runtimeStatus === 'idle' && !hasMissionId;
  const missionChanged = hasMissionId && missionId !== current.currentMissionId;
  const clearWaypoint = missionChanged || !shouldKeepWaypointProgress(nextStatus);
  const nextMode = isRobotRuntimeMode(payload?.mode) ? payload.mode : current.mode;

  return {
    ...current,
    status: nextStatus,
    currentMissionId: clearMissionId ? undefined : nextMissionId,
    waypointIndex: clearWaypoint ? undefined : current.waypointIndex,
    totalWaypoints: clearWaypoint ? undefined : current.totalWaypoints,
    mode: nextMode,
    batteryPercentage:
      typeof payload?.batteryPercentage === 'number' && Number.isFinite(payload.batteryPercentage)
        ? payload.batteryPercentage
        : payload?.batteryPercentage === null
          ? null
          : current.batteryPercentage,
    chargingStatus:
      typeof payload?.chargingStatus === 'string'
        ? payload.chargingStatus
        : payload?.chargingStatus === null
          ? null
          : current.chargingStatus,
    lastSeenTs: eventAt,
    runtimeUpdatedAt: eventAt,
    modeUpdatedAt: isRobotRuntimeMode(payload?.mode) ? eventAt : current.modeUpdatedAt,
    updatedAt: Math.max(current.updatedAt ?? 0, eventAt),
  };
};

const updateFromEvent = (current: MissionStatus, event: RobotMissionEvent): MissionStatus => {
  const eventAt = resolveEventTimestamp(event.event, event.payload);
  if (event.event === 'ROBOT_STATUS_UPDATE') {
    return updateFromRobotStatusUpdate(current, event.payload as RobotStatusUpdatePayload, eventAt);
  }
  if (current.lastEventAt !== undefined && eventAt < current.lastEventAt) {
    return current;
  }
  const eventMissionId = normalizeMissionId((event.payload as any)?.missionId);
  const base: MissionStatus = {
    ...current,
    lastEvent: event.event,
    lastEventAt: eventAt,
    lastEventMissionId: eventMissionId,
    updatedAt: eventAt,
  };

  if (event.event === 'MISSION_START_ACK') {
    return updateFromMissionStartAck(current, event.payload as MissionStartAckPayload, base);
  }
  if (event.event === 'MISSION_CONTROL_ACK') {
    return updateFromMissionControlAck(current, event.payload as MissionControlAckPayload, base);
  }
  if (event.event === 'MISSION_COMPLETED') {
    return updateFromMissionCompleted(current, event.payload as MissionCompletedPayload, base);
  }
  if (event.event === 'WAYPOINT_ACK') {
    return updateFromWaypointAck(current, event.payload as WaypointAckPayload, base);
  }
  if (event.event === 'MODE_CHANGE_ACK') {
    return updateFromModeChangeAck(current, event.payload as ModeChangeAckPayload, base);
  }
  return base;
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
        const current = state.statusByRobot[robotId] ?? ({ status: 'idle' } as MissionStatus);
        const next = updateFromEvent(current, event);
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

    return client.sendEvent(event, payload);
  },

  hydrateFromRobots: (robots: Robot[]) => {
    if (!Array.isArray(robots) || robots.length === 0) return;

    set(state => {
      let changed = false;
      const next = { ...state.statusByRobot };

      for (const robot of robots) {
        if (!robot?.id || !robot.mission) continue;

        const mission = robot.mission;
        const existing = state.statusByRobot[robot.id];
        const parsedUpdatedAt = mission.updatedAt ? Date.parse(mission.updatedAt) : undefined;
        const localFreshTs = existing?.lastEventAt ?? existing?.lastSeenTs ?? existing?.updatedAt;
        if (
          existing &&
          Number.isFinite(parsedUpdatedAt) &&
          Number.isFinite(localFreshTs) &&
          (parsedUpdatedAt as number) < (localFreshTs as number)
        ) {
          continue;
        }

        const resolvedUpdatedAt = Number.isFinite(parsedUpdatedAt)
          ? parsedUpdatedAt
          : existing?.updatedAt;
        const resolvedStatus =
          (mission.status as MissionLifecycleStatus) ?? existing?.status ?? 'idle';
        const keepWaypoint = shouldKeepWaypointProgress(resolvedStatus);

        const nextStatus: MissionStatus = {
          ...existing,
          status: resolvedStatus,
          currentMissionId: mission.currentMissionId ?? existing?.currentMissionId,
          message: mission.message ?? existing?.message,
          lastEvent: mission.lastEvent ?? existing?.lastEvent,
          updatedAt: resolvedUpdatedAt,
          lastEventStatus: mission.lastEventStatus ?? existing?.lastEventStatus,
          lastRequestType: mission.lastRequestType ?? existing?.lastRequestType,
          mode: mission.mode ?? existing?.mode,
          batteryPercentage:
            mission.batteryPercentage !== undefined
              ? mission.batteryPercentage
              : existing?.batteryPercentage,
          chargingStatus:
            mission.chargingStatus !== undefined
              ? mission.chargingStatus
              : existing?.chargingStatus,
          lastSeenTs: mission.lastSeenTs ?? existing?.lastSeenTs,
          waypointIndex: keepWaypoint
            ? (mission.waypointIndex ?? existing?.waypointIndex)
            : undefined,
          totalWaypoints: keepWaypoint
            ? (mission.totalWaypoints ?? existing?.totalWaypoints)
            : undefined,
          runtimeUpdatedAt: mission.lastSeenTs ?? existing?.runtimeUpdatedAt,
          modeUpdatedAt:
            mission.lastSeenTs !== undefined && mission.mode !== undefined
              ? mission.lastSeenTs
              : existing?.modeUpdatedAt,
        };

        const hasChanged =
          !existing ||
          existing.status !== nextStatus.status ||
          existing.currentMissionId !== nextStatus.currentMissionId ||
          existing.message !== nextStatus.message ||
          existing.lastEvent !== nextStatus.lastEvent ||
          existing.updatedAt !== nextStatus.updatedAt ||
          existing.lastEventStatus !== nextStatus.lastEventStatus ||
          existing.lastRequestType !== nextStatus.lastRequestType ||
          existing.mode !== nextStatus.mode ||
          existing.batteryPercentage !== nextStatus.batteryPercentage ||
          existing.chargingStatus !== nextStatus.chargingStatus ||
          existing.lastSeenTs !== nextStatus.lastSeenTs ||
          existing.waypointIndex !== nextStatus.waypointIndex ||
          existing.totalWaypoints !== nextStatus.totalWaypoints ||
          existing.runtimeUpdatedAt !== nextStatus.runtimeUpdatedAt ||
          existing.modeUpdatedAt !== nextStatus.modeUpdatedAt;

        if (!hasChanged) continue;
        next[robot.id] = nextStatus;
        changed = true;
      }

      if (!changed) return state;
      return { statusByRobot: next };
    });
  },
}));
