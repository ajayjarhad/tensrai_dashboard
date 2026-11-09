import { isMissionActivePhase, type MissionStatus } from '@tensrai/shared';
import type { Robot } from '@/types/robot';
import type { MissionRunRecord } from '../api/getMissionRuns';
import type {
  MissionLogView,
  OngoingMissionView,
} from '../components/MissionDock/missionDockModel';
import type { MissionWithContext, PendingMissionStart, ResolveMissionContext } from '../types';
import { missionIsFresh, toDisplayWaypointIndex } from './missionRuntime';

type OngoingMissionSources = {
  robots: Robot[];
  missionStatusByRobot: Record<string, MissionStatus>;
  pendingMissionStarts: Record<string, PendingMissionStart>;
  resolveMissionContext: ResolveMissionContext;
  mapNameById: Record<string, string>;
  selectedRobotId: string | null;
};

const resolveMissionSortRank = (status: OngoingMissionView['status']) => {
  if (status === 'running') return 0;
  if (status === 'paused') return 1;
  return 2;
};

const resolveRunEndedAt = (run: MissionRunRecord) => {
  if (run.endedAt) return Date.parse(run.endedAt);
  if (run.lastEventAt) return Date.parse(run.lastEventAt);
  return Date.parse(run.updatedAt);
};

const toMissionLog = (run: MissionRunRecord): MissionLogView => {
  const startedAt = run.startedAt ? Date.parse(run.startedAt) : undefined;
  const missionId = run.missionId ?? undefined;
  return {
    id: run.id,
    robotId: run.robotId,
    robotName: run.robotNameSnapshot,
    ...(missionId ? { missionId } : {}),
    missionName: run.missionNameSnapshot ?? `Mission ${missionId ?? ''}`.trim(),
    result: run.status === 'COMPLETED' ? 'completed' : 'failed',
    ...(startedAt ? { startedAt } : {}),
    endedAt: resolveRunEndedAt(run),
    ...(typeof run.durationMs === 'number' ? { durationMs: run.durationMs } : {}),
    ...(typeof run.waypointIndex === 'number' ? { waypointIndex: run.waypointIndex } : {}),
    ...(typeof run.totalWaypoints === 'number' ? { totalWaypoints: run.totalWaypoints } : {}),
    ...(run.lastMessage ? { message: run.lastMessage } : {}),
  };
};

export const toMissionLogs = (runs: MissionRunRecord[] | undefined): MissionLogView[] =>
  (runs ?? [])
    .filter(
      run =>
        run.status === 'COMPLETED' ||
        run.status === 'FAILED' ||
        run.status === 'UNKNOWN_TERMINATION'
    )
    .map(run => toMissionLog(run));

const isOngoingMission = (
  status: MissionStatus | undefined,
  hasPendingStart: boolean,
  nowMs: number
): status is MissionStatus => {
  if (!status || !isMissionActivePhase(status.phase)) return false;
  if (!missionIsFresh(status, nowMs)) return false;
  const isPreviewLike = status.phase === 'showing' || status.phase === 'start_pending';
  return !isPreviewLike || hasPendingStart;
};

const parseStartedAt = (startedAt: string | undefined) => {
  const parsed = startedAt ? Date.parse(startedAt) : undefined;
  return Number.isFinite(parsed) ? parsed : undefined;
};

const toOngoingMissionPlace = (
  robot: Robot,
  missionId: string | undefined,
  mission: MissionWithContext | null,
  mapNameById: Record<string, string>
) => {
  const rowMapId = mission?.mapId ?? robot.mapId;
  const rowMapName = mission?.mapName ?? (robot.mapId ? mapNameById[robot.mapId] : undefined);
  return {
    ...(rowMapId ? { mapId: rowMapId } : {}),
    ...(rowMapName !== undefined ? { mapName: rowMapName } : {}),
    ...(missionId ? { missionId } : {}),
    missionName: mission?.name ?? `Mission ${missionId ?? ''}`.trim(),
  };
};

const toOngoingMissionProgress = (status: MissionStatus, mission: MissionWithContext | null) => {
  const startedAt = parseStartedAt(status.startedAt);
  // A robot first reports the total with its first waypoint, which can be minutes away.
  const totalWaypoints = status.totalWaypoints ?? mission?.steps.length;
  const displayWaypointIndex = toDisplayWaypointIndex(status.waypointIndex, totalWaypoints);
  return {
    ...(displayWaypointIndex !== undefined ? { waypointIndex: displayWaypointIndex } : {}),
    ...(totalWaypoints !== undefined ? { totalWaypoints } : {}),
    ...(startedAt ? { startedAt } : {}),
    ...(status.updatedAt !== undefined ? { updatedAt: status.updatedAt } : {}),
    ...(status.lastSeenTs !== undefined ? { lastSeenTs: status.lastSeenTs } : {}),
    ...(status.message ? { message: status.message } : {}),
  };
};

const toOngoingMission = (
  robot: Robot,
  status: MissionStatus,
  resolveMissionContext: ResolveMissionContext,
  mapNameById: Record<string, string>
): OngoingMissionView => {
  const missionId = status.currentMissionId ?? status.lastEventMissionId;
  const mission = resolveMissionContext(missionId, robot.mapId);
  return {
    robotId: robot.id,
    robotName: robot.name,
    ...toOngoingMissionPlace(robot, missionId, mission, mapNameById),
    status: (status.phase === 'start_pending'
      ? 'showing'
      : status.phase) as OngoingMissionView['status'],
    ...toOngoingMissionProgress(status, mission),
  };
};

const pinnedRank = (row: OngoingMissionView, selectedRobotId: string | null) =>
  selectedRobotId !== null && row.robotId === selectedRobotId ? 1 : 0;

const compareOngoingMissions = (
  left: OngoingMissionView,
  right: OngoingMissionView,
  selectedRobotId: string | null
) => {
  const leftPinned = pinnedRank(left, selectedRobotId);
  const rightPinned = pinnedRank(right, selectedRobotId);
  if (leftPinned !== rightPinned) return rightPinned - leftPinned;
  const rankDiff = resolveMissionSortRank(left.status) - resolveMissionSortRank(right.status);
  if (rankDiff !== 0) return rankDiff;
  return left.robotName.localeCompare(right.robotName);
};

export const buildOngoingMissions = ({
  robots,
  missionStatusByRobot,
  pendingMissionStarts,
  resolveMissionContext,
  mapNameById,
  selectedRobotId,
}: OngoingMissionSources): OngoingMissionView[] => {
  const nowMs = Date.now();
  const rows: OngoingMissionView[] = [];

  for (const robot of robots) {
    const status = missionStatusByRobot[robot.id];
    if (!isOngoingMission(status, Boolean(pendingMissionStarts[robot.id]), nowMs)) continue;
    rows.push(toOngoingMission(robot, status, resolveMissionContext, mapNameById));
  }

  rows.sort((left, right) => compareOngoingMissions(left, right, selectedRobotId));

  return rows;
};
