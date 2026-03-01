import { type Robot, RobotMode } from '@/types/robot';

type EmergencyRuntimeSource = 'live' | 'fallback' | 'unknown';

const isEmergencyStatus = (status: RobotMode | undefined) =>
  status === RobotMode.SW_EMERGENCY || status === RobotMode.HW_EMERGENCY;

const hasLiveEmergencyState = (robot: Robot) => robot.emergency?.source === 'live';

export const getRobotEmergencyMode = (robot: Robot): RobotMode | null => {
  if (hasLiveEmergencyState(robot)) {
    if (robot.emergency?.hardwareEmergencyActive) return RobotMode.HW_EMERGENCY;
    if (robot.emergency?.softwareEmergencyActive) return RobotMode.SW_EMERGENCY;
    return null;
  }

  if (robot.status === RobotMode.HW_EMERGENCY) return RobotMode.HW_EMERGENCY;
  if (robot.status === RobotMode.SW_EMERGENCY) return RobotMode.SW_EMERGENCY;
  return null;
};

export const isRobotEmergencyActive = (robot: Robot) => Boolean(getRobotEmergencyMode(robot));

export const getRobotDisplayMode = (robot: Robot): RobotMode => {
  const emergencyMode = getRobotEmergencyMode(robot);
  if (emergencyMode) return emergencyMode;

  if (
    robot.mission?.phase === 'running' ||
    robot.mission?.phase === 'paused' ||
    robot.mission?.phase === 'showing' ||
    robot.mission?.phase === 'start_pending'
  ) {
    return RobotMode.MISSION;
  }
  if (robot.runtimeMode === 'teleop') return RobotMode.TELEOP;
  if (robot.runtimeMode === 'autonomous') return RobotMode.AUTONOMOUS;
  if (robot.status === RobotMode.TELEOP && robot.runtimeMode === 'autonomous') {
    return RobotMode.AUTONOMOUS;
  }
  if (robot.status === RobotMode.UNKNOWN && robot.runtimeMode === 'autonomous') {
    return RobotMode.AUTONOMOUS;
  }
  if (isEmergencyStatus(robot.status) && !emergencyMode) {
    return RobotMode.UNKNOWN;
  }

  return robot.status;
};

export const getRobotDisplayStatusLabel = (robot: Robot) => {
  const displayMode = getRobotDisplayMode(robot);
  if (displayMode === RobotMode.HW_EMERGENCY) return 'HW ESTOP';
  if (displayMode === RobotMode.SW_EMERGENCY) return 'SW ESTOP';
  if (displayMode === RobotMode.TELEOP) return 'TELEOP';
  if (displayMode === RobotMode.AUTONOMOUS) return 'AUTONOMOUS';
  return String(displayMode ?? RobotMode.UNKNOWN).replaceAll('_', ' ');
};

export const mergeEmergencyRuntimeIntoRobot = (
  robot: Robot,
  emergency: Robot['emergency'] | undefined
): Robot => {
  if (!emergency) return robot;

  const source: EmergencyRuntimeSource =
    emergency.connectionStatus === 'connected'
      ? 'live'
      : isEmergencyStatus(robot.status)
        ? 'fallback'
        : 'unknown';

  const liveActive = source === 'live' && emergency.effectiveEmergencyActive;
  const fallbackMode = isEmergencyStatus(robot.status) ? robot.status : null;
  const emergencyMode = liveActive
    ? emergency.hardwareEmergencyActive
      ? RobotMode.HW_EMERGENCY
      : RobotMode.SW_EMERGENCY
    : fallbackMode;

  return {
    ...robot,
    ...(emergencyMode ? { status: emergencyMode } : {}),
    emergency: {
      ...emergency,
      ...(source === 'fallback'
        ? {
            softwareEmergencyActive: robot.status === RobotMode.SW_EMERGENCY,
            hardwareEmergencyActive: robot.status === RobotMode.HW_EMERGENCY,
            effectiveEmergencyActive: isEmergencyStatus(robot.status),
          }
        : {}),
      source,
    },
  };
};
