import { useEffect, useRef } from 'react';
import { emergencyChangeNeedsRefetch } from '@/lib/robotStatus';
import type { Robot } from '@/types/robot';

export const useRefetchOnEmergencyChange = (robots: Robot[], refetchRobots: () => unknown) => {
  const seenRef = useRef(new Map<string, string>());
  const refetchRobotsTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!emergencyChangeNeedsRefetch(seenRef.current, robots)) return;
    if (refetchRobotsTimerRef.current !== null) {
      window.clearTimeout(refetchRobotsTimerRef.current);
    }
    refetchRobotsTimerRef.current = window.setTimeout(() => {
      refetchRobotsTimerRef.current = null;
      void refetchRobots();
    }, 400);
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
