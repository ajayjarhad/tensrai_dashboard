import { isMissionActivePhase, isPreviewLikePhase, type MissionStatus } from '@tensrai/shared';
import { type Robot, RobotMode } from '@/types/robot';

const MISSION_STALE_MS = 120_000;
const MISSION_PREVIEW_STALE_MS = 30_000;

const missionTimestamp = (status?: MissionStatus) => status?.lastSeenTs ?? status?.updatedAt;

export const missionIsFresh = (status?: MissionStatus, nowMs = Date.now()) => {
  const ts = missionTimestamp(status);
  if (!Number.isFinite(ts)) return false;
  const maxAgeMs = isPreviewLikePhase(status?.phase) ? MISSION_PREVIEW_STALE_MS : MISSION_STALE_MS;
  return nowMs - (ts as number) <= maxAgeMs;
};

const missionIsLive = (status?: MissionStatus, nowMs = Date.now()) =>
  missionIsFresh(status, nowMs) && isMissionActivePhase(status?.phase);

export const isMissionTerminalOrIdleStatus = (status?: MissionStatus['phase']) =>
  status === 'idle' || status === 'completed' || status === 'failed' || status === 'cancelled';

export const toDisplayWaypointIndex = (
  rawWaypointIndex?: number,
  totalWaypoints?: number
): number | undefined => {
  if (typeof rawWaypointIndex !== 'number' || !Number.isFinite(rawWaypointIndex)) return undefined;
  const candidate = rawWaypointIndex + 1;
  if (typeof totalWaypoints === 'number' && Number.isFinite(totalWaypoints) && totalWaypoints > 0) {
    return Math.min(Math.max(candidate, 1), totalWaypoints);
  }
  return Math.max(candidate, 1);
};

const resolveRuntimeStatus = (
  robot: Robot,
  mission: MissionStatus | undefined,
  nowMs: number
): RobotMode => {
  if (!mission) return robot.status;
  if (!missionIsFresh(mission, nowMs)) return robot.status;
  if (missionIsLive(mission, nowMs)) return RobotMode.MISSION;
  if (mission.mode === 'teleop') return RobotMode.TELEOP;
  if (mission.mode === 'autonomous') {
    return RobotMode.AUTONOMOUS;
  }
  return robot.status;
};

const resolveLiveBattery = (robot: Robot, mission: MissionStatus) => {
  if (typeof mission.batteryPercentage === 'number' && Number.isFinite(mission.batteryPercentage)) {
    return mission.batteryPercentage;
  }
  return mission.batteryPercentage === null ? undefined : robot.battery;
};

const applyFreshRuntime = (
  merged: Robot,
  mission: MissionStatus,
  liveBattery: number | undefined
) => {
  if (liveBattery !== undefined) merged.battery = liveBattery;
  if (mission.mode !== undefined) merged.runtimeMode = mission.mode;
  if (mission.batteryPercentage !== undefined) {
    merged.runtimeBatteryPercentage = mission.batteryPercentage;
  }
  if (mission.chargingStatus !== undefined) merged.runtimeChargingStatus = mission.chargingStatus;
  if (mission.lastSeenTs !== undefined) merged.runtimeLastSeenTs = mission.lastSeenTs;
};

const applyLiveProgress = (merged: Robot, mission: MissionStatus) => {
  if (mission.waypointIndex !== undefined) merged.waypointIndex = mission.waypointIndex;
  if (mission.totalWaypoints !== undefined) merged.totalWaypoints = mission.totalWaypoints;
};

export const mergeMissionRuntimeIntoRobot = (
  robot: Robot,
  mission: MissionStatus | undefined,
  nowMs: number
): Robot => {
  if (!mission) return robot;

  const liveBattery = resolveLiveBattery(robot, mission);
  const lastSeenIso = mission.lastSeenTs
    ? new Date(mission.lastSeenTs).toISOString()
    : robot.lastSeen;

  const merged: Robot = {
    ...robot,
    status: resolveRuntimeStatus(robot, mission, nowMs),
    lastSeen: lastSeenIso,
  };

  if (missionIsFresh(mission, nowMs)) applyFreshRuntime(merged, mission, liveBattery);
  if (missionIsLive(mission, nowMs)) applyLiveProgress(merged, mission);

  return merged;
};
