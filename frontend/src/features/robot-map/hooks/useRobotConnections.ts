import { useEffect, useRef } from 'react';
import { useRobotMissionStore } from '@/stores/robotMission';
import type { Robot } from '@/types/robot';

// Mission bridges only; the e-stop bridges belong to the app shell and outlive this page.
export const useRobotConnections = (robots: Robot[]) => {
  const connectMission = useRobotMissionStore(state => state.connect);
  const disconnectMission = useRobotMissionStore(state => state.disconnect);
  const missionConnectionsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const nextIds = new Set(robots.map(robot => robot.id));

    nextIds.forEach(id => {
      if (missionConnectionsRef.current.has(id)) return;
      connectMission(id);
      missionConnectionsRef.current.add(id);
    });

    for (const id of Array.from(missionConnectionsRef.current)) {
      if (nextIds.has(id)) continue;
      disconnectMission(id);
      missionConnectionsRef.current.delete(id);
    }
  }, [connectMission, disconnectMission, robots]);

  useEffect(
    () => () => {
      for (const id of Array.from(missionConnectionsRef.current)) {
        disconnectMission(id);
      }
      missionConnectionsRef.current.clear();
    },
    [disconnectMission]
  );
};
