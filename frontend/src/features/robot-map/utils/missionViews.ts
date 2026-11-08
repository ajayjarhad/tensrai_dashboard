import { isMissionActivePhase, type MissionStatus } from '@tensrai/shared';
import type { Robot } from '@/types/robot';
import type { MissionRunRecord } from '../api/getMissionRuns';
import type {
  MissionLogView,
  OngoingMissionView,
} from '../components/MissionDock/missionDockModel';
import type { PendingMissionStart, ResolveMissionContext } from '../types';
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

export const toMissionLogs = (runs: MissionRunRecord[] | undefined): MissionLogView[] =>
  (runs ?? [])
    .filter(
      run =>
        run.status === 'COMPLETED' ||
        run.status === 'FAILED' ||
        run.status === 'UNKNOWN_TERMINATION'
    )
    .map((run): MissionLogView => {
      const startedAt = run.startedAt ? Date.parse(run.startedAt) : undefined;
      const endedAt = run.endedAt
        ? Date.parse(run.endedAt)
        : run.lastEventAt
          ? Date.parse(run.lastEventAt)
          : Date.parse(run.updatedAt);
      const missionId = run.missionId ?? undefined;
      return {
        id: run.id,
        robotId: run.robotId,
        robotName: run.robotNameSnapshot,
        ...(missionId ? { missionId } : {}),
        missionName: run.missionNameSnapshot ?? `Mission ${missionId ?? ''}`.trim(),
        result: run.status === 'COMPLETED' ? 'completed' : 'failed',
        ...(startedAt ? { startedAt } : {}),
        endedAt,
        ...(typeof run.durationMs === 'number' ? { durationMs: run.durationMs } : {}),
        ...(typeof run.waypointIndex === 'number' ? { waypointIndex: run.waypointIndex } : {}),
        ...(typeof run.totalWaypoints === 'number' ? { totalWaypoints: run.totalWaypoints } : {}),
        ...(run.lastMessage ? { message: run.lastMessage } : {}),
      };
    });

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
    if (!status || !isMissionActivePhase(status.phase)) continue;
    if (!missionIsFresh(status, nowMs)) continue;
    const isPreviewLike = status.phase === 'showing' || status.phase === 'start_pending';
    if (isPreviewLike && !pendingMissionStarts[robot.id]) continue;
    const missionId = status.currentMissionId ?? status.lastEventMissionId;
    const mission = resolveMissionContext(missionId, robot.mapId);
    const parsedStartedAt = status.startedAt ? Date.parse(status.startedAt) : undefined;
    const startedAt = Number.isFinite(parsedStartedAt) ? parsedStartedAt : undefined;
    const rowMapId = mission?.mapId ?? robot.mapId;
    const rowMapName = mission?.mapName ?? (robot.mapId ? mapNameById[robot.mapId] : undefined);
    // A robot first reports the total with its first waypoint, which can be minutes away.
    const totalWaypoints = status.totalWaypoints ?? mission?.steps.length;
    const displayWaypointIndex = toDisplayWaypointIndex(status.waypointIndex, totalWaypoints);

    rows.push({
      robotId: robot.id,
      robotName: robot.name,
      ...(rowMapId ? { mapId: rowMapId } : {}),
      ...(rowMapName !== undefined ? { mapName: rowMapName } : {}),
      ...(missionId ? { missionId } : {}),
      missionName: mission?.name ?? `Mission ${missionId ?? ''}`.trim(),
      status: (status.phase === 'start_pending'
        ? 'showing'
        : status.phase) as OngoingMissionView['status'],
      ...(displayWaypointIndex !== undefined ? { waypointIndex: displayWaypointIndex } : {}),
      ...(totalWaypoints !== undefined ? { totalWaypoints } : {}),
      ...(startedAt ? { startedAt } : {}),
      ...(status.updatedAt !== undefined ? { updatedAt: status.updatedAt } : {}),
      ...(status.lastSeenTs !== undefined ? { lastSeenTs: status.lastSeenTs } : {}),
      ...(status.message ? { message: status.message } : {}),
    });
  }

  rows.sort((left, right) => {
    const leftPinned = selectedRobotId !== null && left.robotId === selectedRobotId ? 1 : 0;
    const rightPinned = selectedRobotId !== null && right.robotId === selectedRobotId ? 1 : 0;
    if (leftPinned !== rightPinned) return rightPinned - leftPinned;
    const rankDiff = resolveMissionSortRank(left.status) - resolveMissionSortRank(right.status);
    if (rankDiff !== 0) return rankDiff;
    return left.robotName.localeCompare(right.robotName);
  });

  return rows;
};
