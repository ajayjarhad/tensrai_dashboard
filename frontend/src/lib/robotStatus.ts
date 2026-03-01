import { type Robot, RobotMode } from '@/types/robot';

export const getRobotEmergencyMode = (robot: Robot): RobotMode | null => {
  if (robot.emergency?.hardwareEmergencyActive) return RobotMode.HW_EMERGENCY;
  if (robot.emergency?.softwareEmergencyActive) return RobotMode.SW_EMERGENCY;
  return null;
};

export const isRobotEmergencyActive = (robot: Robot) =>
  Boolean(robot.emergency?.effectiveEmergencyActive);

const isEmergencyStatus = (status: RobotMode | undefined) =>
  status === RobotMode.SW_EMERGENCY || status === RobotMode.HW_EMERGENCY;

export const getRobotDisplayMode = (robot: Robot): RobotMode => {
  const emergencyMode = getRobotEmergencyMode(robot);
  if (emergencyMode) return emergencyMode;

  if (robot.runtimeMode === 'teleop') return RobotMode.TELEOP;
  if (
    robot.mission?.status === 'running' ||
    robot.mission?.status === 'paused' ||
    robot.mission?.status === 'showing'
  ) {
    return RobotMode.MISSION;
  }
  if (robot.runtimeMode === 'autonomous' && robot.status === RobotMode.TELEOP) {
    return RobotMode.UNKNOWN;
  }

  if (
    isEmergencyStatus(robot.status) &&
    robot.emergency &&
    !robot.emergency.effectiveEmergencyActive
  ) {
    return RobotMode.UNKNOWN;
  }

  return robot.status;
};

export const getRobotDisplayStatusLabel = (robot: Robot) => {
  const displayMode = getRobotDisplayMode(robot);
  if (displayMode === RobotMode.HW_EMERGENCY) return 'HW ESTOP';
  if (displayMode === RobotMode.SW_EMERGENCY) return 'SW ESTOP';
  if (displayMode === RobotMode.TELEOP) return 'TELEOP';
  if (robot.runtimeMode === 'autonomous') return 'AUTONOMOUS';
  return String(displayMode ?? RobotMode.UNKNOWN).replaceAll('_', ' ');
};

export const mergeEmergencyRuntimeIntoRobot = (
  robot: Robot,
  emergency: Robot['emergency'] | undefined
): Robot => {
  if (!emergency) return robot;

  const emergencyMode = emergency.hardwareEmergencyActive
    ? RobotMode.HW_EMERGENCY
    : emergency.softwareEmergencyActive
      ? RobotMode.SW_EMERGENCY
      : null;

  return {
    ...robot,
    ...(emergencyMode ? { status: emergencyMode } : {}),
    emergency,
  };
};
