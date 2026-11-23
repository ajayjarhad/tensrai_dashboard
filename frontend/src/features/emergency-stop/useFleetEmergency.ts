import { useCallback, useEffect, useMemo } from 'react';
import { useEmergencyAlerts } from '@/features/robot-map/hooks/useEmergencyAlerts';
import { useRefetchOnEmergencyChange } from '@/features/robot-map/hooks/useRefetchOnEmergencyChange';
import { useRobots } from '@/features/robot-map/hooks/useRobots';
import {
  describeFleet,
  notifyFleetEmergencyResult,
  summarizeEmergency,
} from '@/features/robot-map/utils/fleetEmergency';
import { mergeFleetRobots } from '@/features/robot-map/utils/missionRuntime';
import { useRobotEmergencyStore } from '@/stores/robotEmergency';
import { useRobotMissionStore } from '@/stores/robotMission';

// The fleet e-stop for the whole signed-in app. The e-stop bridges open here and close only when the
// shell unmounts on sign-out, so leaving a page never drops a stop.
export function useFleetEmergency() {
  const { data, refetch } = useRobots();
  const robotsFromApi = useMemo(() => data ?? [], [data]);
  const missionStatusByRobot = useRobotMissionStore(state => state.statusByRobot);
  const emergencyByRobot = useRobotEmergencyStore(state => state.byRobot);
  const syncEmergencyRobots = useRobotEmergencyStore(state => state.syncRobots);
  const disconnectEmergencyRobots = useRobotEmergencyStore(state => state.disconnectAll);
  const sendFleetSoftwareEmergency = useRobotEmergencyStore(
    state => state.sendFleetSoftwareEmergency
  );
  const pendingDispatch = useRobotEmergencyStore(state => state.pendingDispatch);

  const robots = useMemo(
    () => mergeFleetRobots(robotsFromApi, missionStatusByRobot, emergencyByRobot),
    [emergencyByRobot, missionStatusByRobot, robotsFromApi]
  );

  useEffect(() => {
    syncEmergencyRobots(robotsFromApi);
  }, [robotsFromApi, syncEmergencyRobots]);

  useEffect(() => () => disconnectEmergencyRobots(), [disconnectEmergencyRobots]);

  useRefetchOnEmergencyChange(robots, refetch);
  const { emergencyAlerts, acknowledgeEmergencyAlerts } = useEmergencyAlerts(robots, robotsFromApi);

  const dispatch = useCallback(
    async (desiredStatus: boolean) => {
      notifyFleetEmergencyResult(desiredStatus, await sendFleetSoftwareEmergency(desiredStatus));
    },
    [sendFleetSoftwareEmergency]
  );

  const fleet = useMemo(() => describeFleet(robots), [robots]);
  const controls = {
    pendingDesiredStatus: pendingDispatch?.desiredStatus ?? null,
    canSendEmergency: summarizeEmergency(robots).connectedRobots > 0,
    canReleaseSoftware: robots.some(
      robot =>
        robot.emergency?.connectionStatus === 'connected' && robot.emergency.softwareEmergencyActive
    ),
    onEmergencyAll: () => {
      void dispatch(true);
    },
    onReleaseSoftware: () => {
      void dispatch(false);
    },
  };

  return { fleet, controls, emergencyAlerts, acknowledgeEmergencyAlerts };
}
