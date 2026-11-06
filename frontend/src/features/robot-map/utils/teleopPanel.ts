type TeleopTargetMode = 'teleopActive' | 'autonomousActive';

type TeleopPanelOptions = {
  sendModeChange: (robotId: string, targetMode: TeleopTargetMode) => void;
  onRobotChange: (robotId: string | null) => void;
  confirmTimeoutMs: number;
};

// The manual control panel opens before the robot confirms the switch, so until then "not teleop"
// only means the answer has not arrived. Once teleopActive has been sent, any close that doesn't
// hand the robot back leaves it in teleop with no panel, including one whose answer is just late.
export const createTeleopPanel = ({
  sendModeChange,
  onRobotChange,
  confirmTimeoutMs,
}: TeleopPanelOptions) => {
  let robotId: string | null = null;
  let confirmed = false;
  let confirmTimer: ReturnType<typeof setTimeout> | undefined;

  const setRobot = (next: string | null) => {
    clearTimeout(confirmTimer);
    robotId = next;
    confirmed = false;
    onRobotChange(next);
  };

  const close = () => {
    if (!robotId) return;
    sendModeChange(robotId, 'autonomousActive');
    setRobot(null);
  };

  return {
    open(next: string) {
      if (robotId === next) return;
      close();
      sendModeChange(next, 'teleopActive');
      setRobot(next);
      confirmTimer = setTimeout(close, confirmTimeoutMs);
    },
    close,
    // For a robot no longer in the fleet: there is nothing left to send to.
    forget() {
      setRobot(null);
    },
    observeMode(mode: string | undefined) {
      if (!robotId) return;
      if (mode === 'teleop') {
        confirmed = true;
        clearTimeout(confirmTimer);
      } else if (confirmed) {
        setRobot(null);
      }
    },
    dispose() {
      clearTimeout(confirmTimer);
    },
  };
};
