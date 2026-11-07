import { useEffect, useRef } from 'react';
import type { Robot } from '@/types/robot';

export const useRefetchOnEmergencyChange = (robots: Robot[], refetchRobots: () => unknown) => {
  const emergencyStatusSignatureRef = useRef<string>('');
  const refetchRobotsTimerRef = useRef<number | null>(null);

  useEffect(() => {
    // Active flag included so a release refetches the persisted status promptly;
    // the emergency-popup re-arm reads that status rather than waiting for the 10 s poll.
    const signature = robots
      .map(
        robot =>
          `${robot.id}:${robot.emergency?.connectionStatus ?? 'none'}:${
            robot.emergency?.effectiveEmergencyActive ? 1 : 0
          }`
      )
      .sort()
      .join('|');
    if (!signature) return;
    if (!emergencyStatusSignatureRef.current) {
      emergencyStatusSignatureRef.current = signature;
      return;
    }
    if (emergencyStatusSignatureRef.current !== signature) {
      emergencyStatusSignatureRef.current = signature;
      if (refetchRobotsTimerRef.current !== null) {
        window.clearTimeout(refetchRobotsTimerRef.current);
      }
      refetchRobotsTimerRef.current = window.setTimeout(() => {
        refetchRobotsTimerRef.current = null;
        void refetchRobots();
      }, 400);
    }
  }, [refetchRobots, robots]);

  useEffect(
    () => () => {
      if (refetchRobotsTimerRef.current !== null) {
        window.clearTimeout(refetchRobotsTimerRef.current);
      }
    },
    []
  );
};
