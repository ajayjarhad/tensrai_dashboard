import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { MissionStatus } from '@/stores/robotMission';
import type { Robot } from '@/types/robot';
import { createTeleopPanel } from '../utils/teleopPanel';

const TELEOP_CONFIRM_TIMEOUT_MS = 5000;

type TeleopControlOptions = {
  robots: Robot[];
  selectedRobotId: string | null;
  missionStatusByRobot: Record<string, MissionStatus>;
  sendModeChange: (robotId: string, targetMode: 'teleopActive' | 'autonomousActive') => void;
  setIsSidebarOpen: (open: boolean) => void;
};

export const useTeleopControl = ({
  robots,
  selectedRobotId,
  missionStatusByRobot,
  sendModeChange,
  setIsSidebarOpen,
}: TeleopControlOptions) => {
  const [teleopRobotId, setTeleopRobotId] = useState<string | null>(null);

  const [teleopPanel] = useState(() =>
    createTeleopPanel({
      sendModeChange,
      onRobotChange: setTeleopRobotId,
      confirmTimeoutMs: TELEOP_CONFIRM_TIMEOUT_MS,
    })
  );

  useEffect(() => () => teleopPanel.dispose(), [teleopPanel]);

  const enableManualControl = useCallback(
    (robotId: string) => {
      if (!robotId || selectedRobotId !== robotId) {
        toast.error('Select a robot before entering manual control');
        return;
      }
      teleopPanel.open(robotId);
      setIsSidebarOpen(true);
    },
    [selectedRobotId, setIsSidebarOpen, teleopPanel]
  );

  const teleopRobot = teleopRobotId ? (robots.find(r => r.id === teleopRobotId) ?? null) : null;

  useEffect(() => {
    if (teleopRobotId && !robots.some(r => r.id === teleopRobotId)) {
      teleopPanel.forget();
    }
  }, [robots, teleopPanel, teleopRobotId]);

  useEffect(() => {
    if (!selectedRobotId && teleopRobotId) {
      teleopPanel.close();
    }
  }, [selectedRobotId, teleopPanel, teleopRobotId]);

  useEffect(() => {
    if (!teleopRobotId) return;
    const teleopStatus = missionStatusByRobot[teleopRobotId];
    teleopPanel.observeMode(
      teleopStatus?.mode ?? robots.find(robot => robot.id === teleopRobotId)?.runtimeMode
    );
  }, [missionStatusByRobot, robots, teleopPanel, teleopRobotId]);

  return { teleopRobot, closeTeleop: teleopPanel.close, enableManualControl };
};
