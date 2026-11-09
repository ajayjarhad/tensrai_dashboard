import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { shouldRearmEmergencyPopup } from '@/lib/robotStatus';
import type { Robot } from '@/types/robot';
import type { EmergencyAlert } from '../types';

type EmergencyPopupStep =
  | { type: 'none' }
  | { type: 'rearm' }
  | { type: 'show'; ackEventAt: number | null; ackAlertId: string | null };

type EmergencyPopupMemory = {
  initialPopupShown: boolean | undefined;
  lastAckAt: number;
  apiStatus: Robot['status'] | undefined;
};

// Releasing software while hardware still holds the robot acks too, but sets nothing new.
const ackSetsEmergency = (emergency: Robot['emergency']) =>
  (emergency?.lastEventType === 'SOFTWARE_EMERGENCY_ACK' && emergency.softwareEmergencyActive) ||
  (emergency?.lastEventType === 'HARDWARE_EMERGENCY_ACK' && emergency.hardwareEmergencyActive);

const resolveEmergencyPopupStep = (
  robot: Robot,
  { initialPopupShown, lastAckAt, apiStatus }: EmergencyPopupMemory
): EmergencyPopupStep => {
  const eventType = robot.emergency?.lastEventType;
  const eventAt = robot.emergency?.lastEventAt;
  const active = Boolean(robot.emergency?.effectiveEmergencyActive);

  if (!active) {
    // Re-arm the popup only on a genuine release. A bridge disconnect (or the
    // synthetic "connected, inactive" snapshot after a backend restart) also
    // reads as inactive, and re-arming there re-opened the dialog on every reconnect.
    return shouldRearmEmergencyPopup(robot.emergency?.connectionStatus, apiStatus)
      ? { type: 'rearm' }
      : { type: 'none' };
  }

  const canShowInitialSnapshot = eventType === 'EMERGENCY_STATE' && !initialPopupShown;
  const canShowAckPopup = !!eventAt && ackSetsEmergency(robot.emergency) && lastAckAt < eventAt;
  if (!canShowInitialSnapshot && !canShowAckPopup) return { type: 'none' };

  return {
    type: 'show',
    ackEventAt: canShowAckPopup && eventAt ? eventAt : null,
    ackAlertId: canShowAckPopup ? `ack:${robot.id}:${eventType}:${eventAt}` : null,
  };
};

const withoutRobotAlerts = (current: EmergencyAlert[], robotId: string) =>
  current.some(alert => alert.robotId === robotId)
    ? current.filter(alert => alert.robotId !== robotId)
    : current;

const withEmergencyAlert = (
  current: EmergencyAlert[],
  robot: Robot,
  ackAlertId: string | null
): EmergencyAlert[] => {
  const kind = robot.emergency?.hardwareEmergencyActive ? 'hardware' : 'software';
  const alertId = ackAlertId ?? `snapshot:${robot.id}:${kind}`;
  if (current.some(alert => alert.id === alertId)) return current;
  if (current.some(alert => alert.robotId === robot.id && alert.kind === kind)) return current;
  return [
    ...current,
    {
      id: alertId,
      robotId: robot.id,
      robotName: robot.name,
      kind,
    },
  ];
};

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
      const step = resolveEmergencyPopupStep(robot, {
        initialPopupShown: hasShownInitialEmergencyPopupRef.current[robot.id],
        lastAckAt: lastEmergencyAckAtRef.current[robot.id] ?? 0,
        apiStatus: apiStatusById.get(robot.id),
      });

      if (step.type === 'rearm') {
        delete hasShownInitialEmergencyPopupRef.current[robot.id];
        // Still waiting to be acknowledged, an alert for a finished emergency would be false.
        setEmergencyAlerts(current => withoutRobotAlerts(current, robot.id));
        continue;
      }
      if (step.type === 'none') continue;

      // Either path has now surfaced this emergency; a later reconnect snapshot must not repeat it.
      hasShownInitialEmergencyPopupRef.current[robot.id] = true;
      if (step.ackEventAt !== null) {
        lastEmergencyAckAtRef.current[robot.id] = step.ackEventAt;
      }

      setEmergencyAlerts(current => withEmergencyAlert(current, robot, step.ackAlertId));
    }
  }, [apiStatusById, robots]);

  const acknowledgeEmergencyAlert = useCallback(() => {
    setEmergencyAlerts(current => current.slice(1));
  }, []);

  return { currentEmergencyAlert: emergencyAlerts[0] ?? null, acknowledgeEmergencyAlert };
};
