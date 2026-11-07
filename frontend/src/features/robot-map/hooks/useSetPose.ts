import type { ROSPoseWithCovarianceStamped } from '@tensrai/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { worldToRosPose } from '@/lib/map/mapTransforms';
import { useRobotTelemetryStore } from '@/stores/robotTelemetry';
import type { Robot } from '@/types/robot';
import type { PoseConfirmPayload } from '../components/Map/SetPoseLayer';

export const useSetPose = (selectedRobotId: string | null, selectedRobot: Robot | null) => {
  const [isSettingPose, setIsSettingPose] = useState(false);
  const sendInitialPose = useRobotTelemetryStore(state => state.sendInitialPose);

  const handleStartSetPose = () => {
    if (!selectedRobotId || !selectedRobot?.mapId) {
      toast.error('Select a robot before setting pose');
      return;
    }
    setIsSettingPose(true);
    toast.message(
      'Set pose: click anywhere on the map, drag to rotate, then confirm. Esc to cancel.'
    );
  };

  const handlePoseConfirm = (payload: PoseConfirmPayload) => {
    if (!selectedRobotId) {
      toast.error('Select a robot before setting pose');
      setIsSettingPose(false);
      return;
    }

    const rosPose = worldToRosPose({ x: payload.x, y: payload.y }, payload.theta);
    const covariance = Array(36).fill(0);
    covariance[0] = 0.25;
    covariance[7] = 0.25;
    covariance[35] = 0.068;

    const message: ROSPoseWithCovarianceStamped = {
      header: {
        stamp: { sec: 0, nanosec: 0, secs: 0, nsecs: 0 },
        frame_id: 'map',
      },
      pose: {
        pose: rosPose,
        covariance,
      },
    };

    const dispatchResult = sendInitialPose(selectedRobotId, message);
    setIsSettingPose(false);
    if (dispatchResult.status === 'sent') {
      toast.success('Pose command sent');
      return;
    }
    if (dispatchResult.status === 'queued') {
      toast.message('Pose command queued while telemetry reconnects');
      return;
    }
    toast.error('Unable to send pose command: telemetry socket unavailable');
  };

  const handlePoseCancel = () => {
    setIsSettingPose(false);
  };

  return { isSettingPose, handleStartSetPose, handlePoseConfirm, handlePoseCancel };
};
