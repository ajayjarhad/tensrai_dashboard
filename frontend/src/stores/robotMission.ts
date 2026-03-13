import {
  extractMissionCommandId,
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
  | 'preview_pending'
  | 'showing'
  | 'start_pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type MissionStatus = {
  status: MissionLifecycleStatus;
  phase: MissionLifecycleStatus;
  currentMissionId?: string | undefined;
  requestIdLast?: string | undefined;
  runId?: string | undefined;
  startedAt?: string | undefined;
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

const normalizeRequestId = (value: unknown) => {
  if (typeof value !== 'string') return undefined;
  const str = value.trim();
  return str.length ? str : undefined;
};

const normalizeRequestType = (value: unknown) => {
  if (!value) return undefined;
  const raw = String(value).trim().toUpperCase();
  if (raw === 'PAUSE_MISSION' || raw === 'PAUSE') return 'PAUSE';
  if (raw === 'RESUME_MISSION' || raw === 'RESUME') return 'RESUME';
  if (raw === 'CANCEL_MISSION' || raw === 'CANCEL') return 'CANCEL';
  if (raw === 'START_MISSION') return 'START_MISSION';
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
  status === 'running' || status === 'paused' || status === 'showing' || status === 'start_pending';

const isPreviewLikePhase = (status: MissionLifecycleStatus | undefined) =>
  status === 'preview_pending' || status === 'showing' || status === 'start_pending';

const shouldAcceptRunId = (current: MissionStatus, eventRunId: string | undefined) => {
  if (!eventRunId || !current.runId) return true;
  return eventRunId === current.runId;
};

const shouldAcceptRequest = (
  current: MissionStatus,
  requestId: string | undefined,
  eventAt: number
) => {
  if (!requestId || !current.requestIdLast) return true;
  if (requestId === current.requestIdLast) return true;
  return (current.lastEventAt ?? 0) <= eventAt;
};

const setPhase = (base: MissionStatus, phase: MissionLifecycleStatus): MissionStatus => ({
  ...base,
  phase,
  status: phase,
});

const updateFromMissionStartAck = (
  current: MissionStatus,
  payload: MissionStartAckPayload | undefined,
  base: MissionStatus,
  commandId?: string
): MissionStatus => {
  const missionId = normalizeMissionId(payload?.missionId);
  const requestId = normalizeRequestId(payload?.requestId ?? commandId);
  if (!shouldAcceptRequest(current, requestId, base.lastEventAt ?? 0)) return current;
  const ackStatus = payload?.status;
  const message = payload?.message ?? current.message;
  const runId = normalizeRequestId(payload?.runId) ?? current.runId;
  const startedAt = typeof payload?.startedAt === 'string' ? payload.startedAt : current.startedAt;

  if (ackStatus === 'success') {
    return setPhase(
      {
        ...base,
        currentMissionId: missionId ?? current.currentMissionId,
        requestIdLast: requestId ?? current.requestIdLast,
        runId,
        startedAt,
        waypointIndex: 0,
        totalWaypoints: current.totalWaypoints,
        message,
        lastEventStatus: ackStatus,
      },
      'running'
    );
  }

  return setPhase(
    {
      ...base,
      currentMissionId: missionId ?? current.currentMissionId,
      requestIdLast: requestId ?? current.requestIdLast,
      message,
      lastEventStatus: ackStatus,
    },
    current.phase === 'start_pending' ? 'showing' : current.phase
  );
};

const updateFromMissionControlAck = (
  current: MissionStatus,
  payload: MissionControlAckPayload | undefined,
  base: MissionStatus,
  commandId?: string
): MissionStatus => {
  const requestType = normalizeRequestType(payload?.requestType);
  const requestId = normalizeRequestId(payload?.requestId ?? commandId);
  if (!shouldAcceptRequest(current, requestId, base.lastEventAt ?? 0)) return current;
  const missionId = normalizeMissionId(payload?.missionId);
  const ackStatus = payload?.status;
  const message = payload?.message ?? current.message;

  let phase = current.phase;
  if (ackStatus === 'success') {
    if (requestType === 'SHOW_UP') phase = 'showing';
    if (requestType === 'PAUSE') phase = 'paused';
    if (requestType === 'RESUME') phase = 'running';
    if (requestType === 'CANCEL') phase = 'cancelled';
  } else if (requestType === 'SHOW_UP' && current.phase === 'preview_pending') {
    phase = 'idle';
  }

  const clearMission = ackStatus === 'success' && requestType === 'CANCEL';
  const clearWaypoint =
    (ackStatus === 'success' && requestType === 'SHOW_UP') ||
    (ackStatus === 'success' && requestType === 'CANCEL');

  return setPhase(
    {
      ...base,
      currentMissionId: clearMission ? undefined : (missionId ?? current.currentMissionId),
      requestIdLast: requestId ?? current.requestIdLast,
      runId: clearMission ? undefined : current.runId,
      startedAt: clearMission ? undefined : current.startedAt,
      waypointIndex: clearWaypoint ? undefined : current.waypointIndex,
      totalWaypoints: clearWaypoint ? undefined : current.totalWaypoints,
      message,
      lastEventStatus: ackStatus,
      lastRequestType: requestType,
    },
    phase
  );
};

const updateFromMissionCompleted = (
  current: MissionStatus,
  payload: MissionCompletedPayload | undefined,
  base: MissionStatus
): MissionStatus => {
  const runId = normalizeRequestId(payload?.runId);
  if (!shouldAcceptRunId(current, runId)) return current;
  const rawStatus = String(payload?.status ?? '').toLowerCase();
  const missionId = normalizeMissionId(payload?.missionId);
  const phase: MissionLifecycleStatus =
    rawStatus === 'success' ? 'completed' : rawStatus === 'cancelled' ? 'cancelled' : 'failed';

  return setPhase(
    {
      ...base,
      currentMissionId: missionId ?? current.currentMissionId,
      runId: runId ?? current.runId,
      message: payload?.message ?? current.message,
      lastEventStatus: rawStatus || current.lastEventStatus,
    },
    phase
  );
};

const updateFromWaypointAck = (
  current: MissionStatus,
  payload: WaypointAckPayload | undefined,
  base: MissionStatus
): MissionStatus => {
  const runId = normalizeRequestId(payload?.runId);
  if (!shouldAcceptRunId(current, runId)) return current;
  return {
    ...base,
    currentMissionId: normalizeMissionId(payload?.missionId) ?? current.currentMissionId,
    runId: runId ?? current.runId,
    waypointIndex: toFiniteNumber(payload?.waypointIndex) ?? current.waypointIndex,
    totalWaypoints: toFiniteNumber(payload?.totalWaypoints) ?? current.totalWaypoints,
    message: payload?.message ?? current.message,
    lastEventStatus: payload?.status ?? current.lastEventStatus,
  };
};

const updateFromModeChangeAck = (
  current: MissionStatus,
  payload: ModeChangeAckPayload | undefined,
  base: MissionStatus,
  commandId?: string
): MissionStatus => {
  const modeTimestamp =
    parseTimestampMs(payload?.timestamp) ??
    parseTimestampMs(payload?.time) ??
    current.modeUpdatedAt;
  const requestId = normalizeRequestId(payload?.requestId ?? commandId);
  return {
    ...base,
    mode: isRobotRuntimeMode(payload?.currentMode) ? payload.currentMode : current.mode,
    modeUpdatedAt: modeTimestamp,
    message: payload?.message ?? payload?.error ?? current.message,
    lastEventStatus: payload?.status ?? current.lastEventStatus,
    requestIdLast: requestId ?? current.requestIdLast,
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

  const runtimePhase = fromRuntimeMissionStatus(payload?.mission?.status);
  const missionId = normalizeMissionId(payload?.mission?.currentMissionId);
  const runtimeRunId = normalizeRequestId(payload?.mission?.runId);
  const hasMissionId =
    payload?.mission !== undefined &&
    payload?.mission !== null &&
    Object.hasOwn(payload.mission, 'currentMissionId');
  const shouldPreserveLocalPreview =
    isPreviewLikePhase(current.phase) && runtimePhase === 'idle' && !missionId && !runtimeRunId;
  const nextPhase = shouldPreserveLocalPreview ? current.phase : (runtimePhase ?? current.phase);
  const nextMissionId = shouldPreserveLocalPreview
    ? current.currentMissionId
    : hasMissionId
      ? missionId
      : current.currentMissionId;
  const clearMissionId = shouldPreserveLocalPreview
    ? false
    : runtimePhase === 'idle' && !hasMissionId;
  const missionChanged = hasMissionId && missionId !== current.currentMissionId;
  const clearWaypoint = missionChanged || !shouldKeepWaypointProgress(nextPhase);
  const nextMode = isRobotRuntimeMode(payload?.mode) ? payload.mode : current.mode;

  return setPhase(
    {
      ...current,
      currentMissionId: clearMissionId ? undefined : nextMissionId,
      runId: shouldPreserveLocalPreview
        ? current.runId
        : (runtimeRunId ?? (nextPhase === 'idle' ? undefined : current.runId)),
      startedAt: shouldPreserveLocalPreview
        ? current.startedAt
        : typeof payload?.mission?.startedAt === 'string'
          ? payload.mission.startedAt
          : nextPhase === 'idle'
            ? undefined
            : current.startedAt,
      waypointIndex: clearWaypoint
        ? undefined
        : (toFiniteNumber(payload?.mission?.currentWaypointIndex) ?? current.waypointIndex),
      totalWaypoints: clearWaypoint
        ? undefined
        : (toFiniteNumber(payload?.mission?.totalWaypoints) ?? current.totalWaypoints),
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
    },
    nextPhase
  );
};

const updateFromEvent = (current: MissionStatus, event: RobotMissionEvent): MissionStatus => {
  const eventAt = resolveEventTimestamp(event.event, event.payload);
  const commandId = extractMissionCommandId(event);
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
    return updateFromMissionStartAck(
      current,
      event.payload as MissionStartAckPayload,
      base,
      commandId
    );
  }
  if (event.event === 'MISSION_CONTROL_ACK') {
    return updateFromMissionControlAck(
      current,
      event.payload as MissionControlAckPayload,
      base,
      commandId
    );
  }
  if (event.event === 'MISSION_COMPLETED') {
    return updateFromMissionCompleted(current, event.payload as MissionCompletedPayload, base);
  }
  if (event.event === 'WAYPOINT_ACK') {
    return updateFromWaypointAck(current, event.payload as WaypointAckPayload, base);
  }
  if (event.event === 'MODE_CHANGE_ACK') {
    return updateFromModeChangeAck(current, event.payload as ModeChangeAckPayload, base, commandId);
  }
  return base;
};

const recordIntent = (
  current: MissionStatus,
  event: string,
  payload: Record<string, unknown>,
  commandId?: string
): MissionStatus => {
  const now = Date.now();
  const missionId = normalizeMissionId(payload['missionId']);
  const requestId = normalizeRequestId(commandId ?? payload['requestId']);
  const requestType = normalizeRequestType(event);
  const base: MissionStatus = {
    ...current,
    lastEvent: event,
    lastEventAt: now,
    updatedAt: now,
    lastEventMissionId: missionId ?? current.currentMissionId,
    lastEventStatus: 'pending',
    lastRequestType: requestType,
    requestIdLast: requestId,
  };

  if (event === 'SHOW_UP') {
    return setPhase(
      {
        ...base,
        currentMissionId: missionId,
        runId: undefined,
        startedAt: undefined,
        waypointIndex: undefined,
        totalWaypoints: undefined,
        message: 'SHOW_UP sent… waiting for robot',
      },
      'preview_pending'
    );
  }

  if (event === 'START_MISSION') {
    return setPhase(
      {
        ...base,
        currentMissionId: missionId ?? current.currentMissionId,
        message: 'Starting… waiting for robot ack',
      },
      'start_pending'
    );
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
        const current =
          state.statusByRobot[robotId] ?? ({ status: 'idle', phase: 'idle' } as MissionStatus);
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

    const result = client.sendEvent(event, payload);
    if (result.accepted) {
      set(state => {
        const current =
          state.statusByRobot[robotId] ?? ({ status: 'idle', phase: 'idle' } as MissionStatus);
        return {
          statusByRobot: {
            ...state.statusByRobot,
            [robotId]: recordIntent(current, event, payload, result.commandId),
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
        const incomingPhase =
          (mission.phase as MissionLifecycleStatus) ??
          (mission.status as MissionLifecycleStatus) ??
          existing?.phase ??
          'idle';
        const preserveLocalPreview =
          isPreviewLikePhase(existing?.phase) &&
          incomingPhase === 'idle' &&
          !mission.currentMissionId &&
          !mission.runId;
        const resolvedPhase = preserveLocalPreview
          ? (existing?.phase ?? incomingPhase)
          : incomingPhase;
        const keepWaypoint = shouldKeepWaypointProgress(resolvedPhase);

        const nextStatus: MissionStatus = {
          ...existing,
          status: resolvedPhase,
          phase: resolvedPhase,
          currentMissionId: preserveLocalPreview
            ? existing?.currentMissionId
            : (mission.currentMissionId ?? existing?.currentMissionId),
          requestIdLast: preserveLocalPreview
            ? existing?.requestIdLast
            : (mission.requestIdLast ?? existing?.requestIdLast),
          runId: preserveLocalPreview ? existing?.runId : (mission.runId ?? existing?.runId),
          startedAt: preserveLocalPreview
            ? existing?.startedAt
            : (mission.startedAt ?? existing?.startedAt),
          message: preserveLocalPreview
            ? existing?.message
            : (mission.message ?? existing?.message),
          lastEvent: preserveLocalPreview
            ? existing?.lastEvent
            : (mission.lastEvent ?? existing?.lastEvent),
          updatedAt: resolvedUpdatedAt,
          lastEventStatus: preserveLocalPreview
            ? existing?.lastEventStatus
            : (mission.lastEventStatus ?? existing?.lastEventStatus),
          lastRequestType: preserveLocalPreview
            ? existing?.lastRequestType
            : (mission.lastRequestType ?? existing?.lastRequestType),
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

        const hasChanged = JSON.stringify(existing ?? {}) !== JSON.stringify(nextStatus);
        if (!hasChanged) continue;
        next[robot.id] = nextStatus;
        changed = true;
      }

      if (!changed) return state;
      return { statusByRobot: next };
    });
  },
}));
