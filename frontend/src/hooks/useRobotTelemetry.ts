import { useEffect } from 'react';
import { useRobotTelemetryStore } from '../stores/robotTelemetry';

export const useRobotTelemetry = (robotId: string | null | undefined) => {
  const connect = useRobotTelemetryStore(state => state.connect);
  const disconnect = useRobotTelemetryStore(state => state.disconnect);
  const sendTeleop = useRobotTelemetryStore(state => state.sendTeleop);
  const sendMode = useRobotTelemetryStore(state => state.sendMode);
  const sendEmergency = useRobotTelemetryStore(state => state.sendEmergency);
  const sendInitialPose = useRobotTelemetryStore(state => state.sendInitialPose);
  const telemetry = useRobotTelemetryStore(state =>
    robotId ? state.telemetry[robotId] : undefined
  );

  useEffect(() => {
    if (!robotId) return;
    connect(robotId);
    return () => {
      disconnect(robotId);
    };
  }, [robotId, connect, disconnect]);

  return {
    telemetry,
    sendTeleop,
    sendMode,
    sendEmergency,
    sendInitialPose,
  };
};
