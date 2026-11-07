import { toast } from 'sonner';
import type { MissionStatus } from '@/stores/robotMission';
import type { Robot } from '@/types/robot';
import { toDisplayWaypointIndex } from './missionRuntime';

export const toastMissionEvent = (robot: Robot, status: MissionStatus, missionName: string) => {
  const prefix = `${robot.name}: `;

  if (status.lastEvent === 'MISSION_START_ACK') {
    if (status.lastEventStatus === 'success') {
      toast.success(`${prefix}${missionName} started`);
    } else {
      toast.error(status.message ?? `${prefix}${missionName} failed to start`);
    }
    return;
  }

  if (status.lastEvent === 'MISSION_CONTROL_ACK') {
    const requestType = status.lastRequestType ?? 'UNKNOWN';
    if (status.lastEventStatus === 'success') {
      if (requestType === 'SHOW_UP') toast.success(`${prefix}${missionName} ready to start`);
      if (requestType === 'PAUSE') toast.message(`${prefix}${missionName} paused`);
      if (requestType === 'RESUME') toast.success(`${prefix}${missionName} resumed`);
      if (requestType === 'CANCEL') {
        toast.message(`${prefix}${missionName} cancelled`, { id: `cancelled:${robot.id}` });
      }
    } else {
      toast.error(status.message ?? `${prefix}${missionName} control failed`);
    }
    return;
  }

  if (status.lastEvent === 'MISSION_COMPLETED') {
    if (status.lastEventStatus === 'success') {
      toast.success(`${prefix}${missionName} completed`);
    } else if (status.lastEventStatus === 'cancelled') {
      // The robot acks the request and then completes; one cancellation, one toast.
      toast.message(`${prefix}${missionName} cancelled`, { id: `cancelled:${robot.id}` });
    } else {
      toast.error(`${prefix}${missionName} failed`);
    }
    return;
  }

  if (status.lastEvent === 'MODE_CHANGE_ACK') {
    if (status.lastEventStatus === 'success') {
      toast.message(
        status.mode
          ? `${prefix}mode changed to ${status.mode}`
          : `${prefix}mode changed successfully`
      );
    } else {
      toast.error(status.message ?? `${prefix}mode change failed`);
    }
    return;
  }

  if (status.lastEvent === 'WAYPOINT_ACK') {
    const displayWaypointIndex = toDisplayWaypointIndex(
      status.waypointIndex,
      status.totalWaypoints
    );
    if (displayWaypointIndex && status.totalWaypoints) {
      toast.message(
        `${prefix}${missionName}: waypoint ${displayWaypointIndex}/${status.totalWaypoints}`
      );
    } else {
      toast.message(status.message ?? `${prefix}${missionName}: waypoint reached`);
    }
  }
};
