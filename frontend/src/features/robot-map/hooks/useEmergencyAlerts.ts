import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { shouldRearmEmergencyPopup } from '@/lib/robotStatus';
import type { Robot } from '@/types/robot';
import type { EmergencyAlert } from '../types';

export const useEmergencyAlerts = (robots: Robot[], robotsFromApi: Robot[]) => {
  const [emergencyAlerts, setEmergencyAlerts] = useState<EmergencyAlert[]>([]);
  const lastEmergencyAckAtRef = useRef<Record<string, number>>({});
  const hasShownInitialEmergencyPopupRef = useRef<Record<string, boolean>>({});

  // Persisted status straight from the API. The merged `robots` status is rewritten to
  // TELEOP/AUTONOMOUS whenever the mission bridge heartbeats, so it cannot tell us
  // whether the backend still considers the robot e-stopped.
  const apiStatusById = useMemo(
    () => new Map(robotsFromApi.map(robot => [robot.id, robot.status])),
    [robotsFromApi]
  );

  useEffect(() => {
    for (const robot of robots) {
      const eventType = robot.emergency?.lastEventType;
      const eventAt = robot.emergency?.lastEventAt;
      const active = Boolean(robot.emergency?.effectiveEmergencyActive);
      const canShowInitialSnapshot =
        active &&
        eventType === 'EMERGENCY_STATE' &&
        !hasShownInitialEmergencyPopupRef.current[robot.id];
      // Releasing software while hardware still holds the robot acks too, but sets nothing new.
      const ackSetEmergency =
        (eventType === 'SOFTWARE_EMERGENCY_ACK' && robot.emergency?.softwareEmergencyActive) ||
        (eventType === 'HARDWARE_EMERGENCY_ACK' && robot.emergency?.hardwareEmergencyActive);
      const canShowAckPopup =
        active &&
        !!eventAt &&
        ackSetEmergency &&
        (lastEmergencyAckAtRef.current[robot.id] ?? 0) < eventAt;

      if (!active) {
        // Re-arm the popup only on a genuine release. A bridge disconnect (or the
        // synthetic "connected, inactive" snapshot after a backend restart) also
        // reads as inactive, and re-arming there re-opened the dialog on every reconnect.
        if (
          shouldRearmEmergencyPopup(robot.emergency?.connectionStatus, apiStatusById.get(robot.id))
        ) {
          delete hasShownInitialEmergencyPopupRef.current[robot.id];
          // Still waiting to be acknowledged, an alert for a finished emergency would be false.
          setEmergencyAlerts(current =>
            current.some(alert => alert.robotId === robot.id)
              ? current.filter(alert => alert.robotId !== robot.id)
              : current
          );
        }
        continue;
      }

      if (!canShowInitialSnapshot && !canShowAckPopup) {
        continue;
      }

      // Either path has now surfaced this emergency; a later reconnect snapshot must not repeat it.
      hasShownInitialEmergencyPopupRef.current[robot.id] = true;
      if (canShowAckPopup && eventAt) {
        lastEmergencyAckAtRef.current[robot.id] = eventAt;
      }

      setEmergencyAlerts(current => {
        const kind = robot.emergency?.hardwareEmergencyActive ? 'hardware' : 'software';
        const alertId = canShowAckPopup
          ? `ack:${robot.id}:${eventType}:${eventAt}`
          : `snapshot:${robot.id}:${kind}`;
        if (current.some(alert => alert.id === alertId)) return current;
        if (current.some(alert => alert.robotId === robot.id && alert.kind === kind))
          return current;
        return [
          ...current,
          {
            id: alertId,
            robotId: robot.id,
            robotName: robot.name,
            kind,
          },
        ];
      });
    }
  }, [apiStatusById, robots]);

  const acknowledgeEmergencyAlert = useCallback(() => {
    setEmergencyAlerts(current => current.slice(1));
  }, []);

  return { currentEmergencyAlert: emergencyAlerts[0] ?? null, acknowledgeEmergencyAlert };
};
