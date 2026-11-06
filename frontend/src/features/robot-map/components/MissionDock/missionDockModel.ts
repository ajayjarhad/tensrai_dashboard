import type { Robot } from '@/types/robot';
import type { MissionWithContext } from '../../types';

export type OngoingMissionView = {
  robotId: string;
  robotName: string;
  mapId?: string;
  mapName?: string;
  missionId?: string;
  missionName: string;
  status: 'showing' | 'running' | 'paused';
  waypointIndex?: number;
  totalWaypoints?: number;
  startedAt?: number;
  elapsedMs?: number;
  message?: string;
  updatedAt?: number;
  lastSeenTs?: number;
};

export type MissionLogView = {
  id: string;
  robotId: string;
  robotName: string;
  missionId?: string;
  missionName: string;
  result: 'completed' | 'failed';
  startedAt?: number;
  endedAt: number;
  durationMs?: number;
  waypointIndex?: number;
  totalWaypoints?: number;
  message?: string;
};

export interface MissionDockProps {
  robots: Robot[];
  missions: MissionWithContext[];
  ongoingMissions: OngoingMissionView[];
  missionLogs: MissionLogView[];
  focusedMission: { robotId: string; missionId?: string } | null;
  selectedRobotId?: string | null | undefined;
  startRobotId: string | null;
  startMissionId: string | null;
  pendingStart: {
    robotId: string;
    mission: MissionWithContext;
  } | null;
  pendingPhase?: 'preview_pending' | 'showing' | 'start_pending' | 'running' | 'paused' | undefined;
  pendingMessage?: string | undefined;
  onSetStartRobot: (robotId: string | null) => void;
  onSetStartMission: (missionId: string | null) => void;
  onShowUp: (robotId: string, missionId: string) => void;
  onConfirmStart: () => void;
  onCancelStart: () => void;
  onFocusMission: (robotId: string, missionId?: string) => void;
  onClearFocus: () => void;
  onPauseMission: (robotId: string, missionId?: string) => void;
  onResumeMission: (robotId: string, missionId?: string) => void;
  onCancelMission: (robotId: string, missionId?: string) => void;
}

export const formatDuration = (value?: number) => {
  if (!value || value < 0) return '--';
  const totalSec = Math.floor(value / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
};

export const missionElapsedLabel = (mission: OngoingMissionView, clockNowMs: number) =>
  formatDuration(mission.startedAt ? clockNowMs - mission.startedAt : mission.elapsedMs);

export const matchesFocus = (
  mission: OngoingMissionView,
  focus: NonNullable<MissionDockProps['focusedMission']>
) =>
  mission.robotId === focus.robotId &&
  (focus.missionId ? mission.missionId === focus.missionId : true);

export const statusClass = (status: OngoingMissionView['status']) => {
  if (status === 'running') return 'bg-status-active/20 text-status-active';
  if (status === 'paused') return 'bg-amber-500/20 text-amber-700';
  return 'bg-blue-500/20 text-blue-700';
};
