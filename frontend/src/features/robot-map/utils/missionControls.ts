// Cancel only ends a mission and never moves the robot, so it stays available during an e-stop.
export const isMissionControlAllowedDuringEmergency = (event: string) => event === 'CANCEL_MISSION';
