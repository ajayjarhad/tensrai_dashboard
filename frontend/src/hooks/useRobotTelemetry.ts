import { useEffect } from 'react';
import { useRobotTelemetryStore } from '../stores/robotTelemetry';

export const useRobotTelemetry = (robotId: string | null | undefined) => {
  const { telemetry, connect, disconnect, sendTeleop, sendMode, sendEmergency, sendInitialPose } =
    useRobotTelemetryStore();

  useEffect(() => {
    if (!robotId) return;
    connect(robotId);
    return () => {
      disconnect(robotId);
    };
  }, [robotId, connect, disconnect]);

  const state = robotId ? telemetry[robotId] : undefined;

  return {
    telemetry: state,
    sendTeleop,
    sendMode,
    sendEmergency,
    sendInitialPose,
  };
};
