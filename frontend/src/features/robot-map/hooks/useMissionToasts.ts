import { useEffect, useRef } from 'react';
import type { MissionStatus } from '@/stores/robotMission';
import type { Robot } from '@/types/robot';
import type { ResolveMissionContext } from '../types';
import { toastMissionEvent } from '../utils/missionToasts';

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
      for (const robot of robots) {
        const status = missionStatusByRobot[robot.id];
        if (status?.lastEventAt) {
          lastMissionToastRef.current[robot.id] = status.lastEventAt;
        }
      }
      missionToastsPrimedRef.current = true;
      return;
    }

    for (const robot of robots) {
      const status = missionStatusByRobot[robot.id];
      if (!status?.lastEvent || !status.lastEventAt) continue;

      const lastSeen = lastMissionToastRef.current[robot.id] ?? 0;
      if (status.lastEventAt <= lastSeen) continue;
      lastMissionToastRef.current[robot.id] = status.lastEventAt;

      const missionId = status.lastEventMissionId ?? status.currentMissionId;
      const missionName =
        (missionId ? resolveMissionContext(missionId, robot.mapId)?.name : null) ??
        (missionId ? `Mission ${missionId}` : 'Mission');
      toastMissionEvent(robot, status, missionName);
    }
  }, [missionStatusByRobot, resolveMissionContext, robots]);
};
