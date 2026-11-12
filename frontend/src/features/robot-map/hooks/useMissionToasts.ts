import type { MissionStatus } from '@tensrai/shared';
import { useEffect, useRef } from 'react';
import type { Robot } from '@/types/robot';
import type { ResolveMissionContext } from '../types';
import { toastMissionEvent } from '../utils/missionToasts';

type MissionEventStatus = MissionStatus & { lastEvent: string; lastEventAt: number };

const collectLastEventTimes = (
  robots: Robot[],
  missionStatusByRobot: Record<string, MissionStatus>
) => {
  const lastEventAtByRobot: Record<string, number> = {};
  for (const robot of robots) {
    const lastEventAt = missionStatusByRobot[robot.id]?.lastEventAt;
    if (lastEventAt) lastEventAtByRobot[robot.id] = lastEventAt;
  }
  return lastEventAtByRobot;
};

const isUnseenMissionEvent = (
  status: MissionStatus | undefined,
  lastSeenAt = 0
): status is MissionEventStatus =>
  Boolean(status?.lastEvent && status.lastEventAt && status.lastEventAt > lastSeenAt);

const resolveToastMissionName = (
  robot: Robot,
  status: MissionStatus,
  resolveMissionContext: ResolveMissionContext
) => {
  const missionId = status.lastEventMissionId ?? status.currentMissionId;
  if (!missionId) return 'Mission';
  return resolveMissionContext(missionId, robot.mapId)?.name ?? `Mission ${missionId}`;
};

export const useMissionToasts = (
  robots: Robot[],
  missionStatusByRobot: Record<string, MissionStatus>,
  resolveMissionContext: ResolveMissionContext
) => {
  const lastMissionToastRef = useRef<Record<string, number>>({});
  const missionToastsPrimedRef = useRef(false);

  useEffect(() => {
    if (!missionToastsPrimedRef.current) {
      if (robots.length === 0) return;
      Object.assign(
        lastMissionToastRef.current,
        collectLastEventTimes(robots, missionStatusByRobot)
      );
      missionToastsPrimedRef.current = true;
      return;
    }

    for (const robot of robots) {
      const status = missionStatusByRobot[robot.id];
      if (!isUnseenMissionEvent(status, lastMissionToastRef.current[robot.id])) continue;
      lastMissionToastRef.current[robot.id] = status.lastEventAt;
      toastMissionEvent(
        robot,
        status,
        resolveToastMissionName(robot, status, resolveMissionContext)
      );
    }
  }, [missionStatusByRobot, resolveMissionContext, robots]);
};
