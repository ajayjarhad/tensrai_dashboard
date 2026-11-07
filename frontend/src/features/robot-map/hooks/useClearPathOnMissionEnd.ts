import { useEffect, useRef } from 'react';
import type { MissionStatus } from '@/stores/robotMission';
import { useRobotTelemetryStore } from '@/stores/robotTelemetry';
import { isMissionTerminalOrIdleStatus } from '../utils/missionRuntime';

export const useClearPathOnMissionEnd = (missionStatusByRobot: Record<string, MissionStatus>) => {
  const clearPath = useRobotTelemetryStore(state => state.clearPath);
  const previousMissionPhaseByRobotRef = useRef<Record<string, MissionStatus['phase'] | undefined>>(
    {}
  );

  useEffect(() => {
    const previous = previousMissionPhaseByRobotRef.current;
    const next: Record<string, MissionStatus['phase'] | undefined> = {};

    for (const [robotId, status] of Object.entries(missionStatusByRobot)) {
      const currentPhase = status?.phase;
      const previousPhase = previous[robotId];
      next[robotId] = currentPhase;
      if (!isMissionTerminalOrIdleStatus(currentPhase)) continue;
      if (previousPhase === currentPhase) continue;
      clearPath(robotId);
    }

    previousMissionPhaseByRobotRef.current = next;
  }, [clearPath, missionStatusByRobot]);
};
