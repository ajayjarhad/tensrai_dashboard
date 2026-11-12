import type { MissionStatus } from '@tensrai/shared';
import { toast } from 'sonner';
import type { Robot } from '@/types/robot';
import { toDisplayWaypointIndex } from './missionRuntime';

type MissionToastContext = {
  robot: Robot;
  status: MissionStatus;
  label: string;
};

const toastStartAck = ({ status, label }: MissionToastContext) => {
  if (status.lastEventStatus === 'success') {
    toast.success(`${label} started`);
  } else {
    toast.error(status.message ?? `${label} failed to start`);
  }
};

const toastControlSuccess = ({ robot, status, label }: MissionToastContext) => {
  const requestType = status.lastRequestType ?? 'UNKNOWN';
  if (requestType === 'SHOW_UP') toast.success(`${label} ready to start`);
  if (requestType === 'PAUSE') toast.message(`${label} paused`);
  if (requestType === 'RESUME') toast.success(`${label} resumed`);
  if (requestType === 'CANCEL') {
    toast.message(`${label} cancelled`, { id: `cancelled:${robot.id}` });
  }
};

const toastControlAck = (context: MissionToastContext) => {
  if (context.status.lastEventStatus === 'success') {
    toastControlSuccess(context);
  } else {
    toast.error(context.status.message ?? `${context.label} control failed`);
  }
};

const toastCompleted = ({ robot, status, label }: MissionToastContext) => {
  if (status.lastEventStatus === 'success') {
    toast.success(`${label} completed`);
  } else if (status.lastEventStatus === 'cancelled') {
    // The robot acks the request and then completes; one cancellation, one toast.
    toast.message(`${label} cancelled`, { id: `cancelled:${robot.id}` });
  } else {
    toast.error(`${label} failed`);
  }
};

const toastModeChangeAck = ({ robot, status }: MissionToastContext) => {
  const prefix = `${robot.name}: `;
  if (status.lastEventStatus === 'success') {
    toast.message(
      status.mode ? `${prefix}mode changed to ${status.mode}` : `${prefix}mode changed successfully`
    );
  } else {
    toast.error(status.message ?? `${prefix}mode change failed`);
  }
};

const toastWaypointAck = ({ status, label }: MissionToastContext) => {
  const displayWaypointIndex = toDisplayWaypointIndex(status.waypointIndex, status.totalWaypoints);
  if (displayWaypointIndex && status.totalWaypoints) {
    toast.message(`${label}: waypoint ${displayWaypointIndex}/${status.totalWaypoints}`);
  } else {
    toast.message(status.message ?? `${label}: waypoint reached`);
  }
};

export const toastMissionEvent = (robot: Robot, status: MissionStatus, missionName: string) => {
  const context: MissionToastContext = { robot, status, label: `${robot.name}: ${missionName}` };

  switch (status.lastEvent) {
    case 'MISSION_START_ACK':
      toastStartAck(context);
      break;
    case 'MISSION_CONTROL_ACK':
      toastControlAck(context);
      break;
    case 'MISSION_COMPLETED':
      toastCompleted(context);
      break;
    case 'MODE_CHANGE_ACK':
      toastModeChangeAck(context);
      break;
    case 'WAYPOINT_ACK':
      toastWaypointAck(context);
      break;
  }
};
