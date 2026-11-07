import { useCallback } from 'react';
import { toast } from 'sonner';
import { type MissionStatus, useRobotMissionStore } from '@/stores/robotMission';
import type { Robot } from '@/types/robot';

const MISSION_CONTROLS = {
  PAUSE_MISSION: {
    noMission: 'No active mission to pause',
    queuedMessage: 'Pause command queued',
    errorMessage: 'Unable to send pause command',
  },
  RESUME_MISSION: {
    noMission: 'No paused mission to resume',
    queuedMessage: 'Resume command queued',
    errorMessage: 'Unable to send resume command',
  },
  CANCEL_MISSION: {
    noMission: 'No mission to cancel',
    queuedMessage: 'Cancel command queued',
    errorMessage: 'Unable to send cancel command',
  },
} as const;

export const useMissionCommands = (
  robotsById: Map<string, Robot>,
  missionStatusByRobot: Record<string, MissionStatus>
) => {
  const sendMissionEvent = useRobotMissionStore(state => state.sendEvent);

  const isRobotEmergencyBlocked = useCallback(
    (robotId: string) => {
      return Boolean(robotsById.get(robotId)?.emergency?.effectiveEmergencyActive);
    },
    [robotsById]
  );

  const dispatchMissionEvent = useCallback(
    (
      robotId: string,
      event: string,
      payload: Record<string, unknown>,
      options?: { queuedMessage?: string; errorMessage?: string }
    ) => {
      const result = sendMissionEvent(robotId, event, payload);
      if (!result.accepted) {
        toast.error(options?.errorMessage ?? 'Failed to send mission command');
        return false;
      }
      if (result.queued) {
        toast.message(
          options?.queuedMessage ?? 'Robot mission socket is reconnecting. Command queued.'
        );
      }
      return true;
    },
    [sendMissionEvent]
  );

  const sendMissionControl = useCallback(
    (event: keyof typeof MISSION_CONTROLS, robotId: string, missionId?: string) => {
      if (isRobotEmergencyBlocked(robotId)) {
        toast.error('Controls unavailable while emergency stop is active');
        return;
      }
      const resolvedId = missionId || missionStatusByRobot[robotId]?.currentMissionId;
      const { noMission, ...messages } = MISSION_CONTROLS[event];
      if (!resolvedId) {
        toast.error(noMission);
        return;
      }
      dispatchMissionEvent(robotId, event, { missionId: resolvedId }, messages);
    },
    [dispatchMissionEvent, isRobotEmergencyBlocked, missionStatusByRobot]
  );

  const handlePauseMission = useCallback(
    (robotId: string, missionId?: string) => {
      sendMissionControl('PAUSE_MISSION', robotId, missionId);
    },
    [sendMissionControl]
  );

  const handleResumeMission = useCallback(
    (robotId: string, missionId?: string) => {
      sendMissionControl('RESUME_MISSION', robotId, missionId);
    },
    [sendMissionControl]
  );

  const handleCancelMission = useCallback(
    (robotId: string, missionId?: string) => {
      sendMissionControl('CANCEL_MISSION', robotId, missionId);
    },
    [sendMissionControl]
  );

  const sendModeChange = useCallback(
    (robotId: string, targetMode: 'teleopActive' | 'autonomousActive') => {
      dispatchMissionEvent(
        robotId,
        'CHANGE_MODE',
        { targetMode },
        { queuedMessage: 'Mode change command queued', errorMessage: 'Unable to change mode' }
      );
    },
    [dispatchMissionEvent]
  );

  return {
    isRobotEmergencyBlocked,
    dispatchMissionEvent,
    handlePauseMission,
    handleResumeMission,
    handleCancelMission,
    sendModeChange,
  };
};
