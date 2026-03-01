import { CheckCircle2, ChevronDown, ChevronUp, Pause, Play, Target, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { getRobotDisplayStatusLabel, isRobotEmergencyActive } from '@/lib/robotStatus';
import { cn } from '@/lib/utils';
import type { Robot } from '@/types/robot';
import type { MissionWithContext } from '../MissionDialog';

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

interface MissionDockProps {
  robots: Robot[];
  missions: MissionWithContext[];
  ongoingMissions: OngoingMissionView[];
  missionLogs: MissionLogView[];
  focusedMission: { robotId: string; missionId?: string } | null;
  selectedRobotId?: string | null;
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

const formatDateTime = (value?: number) => {
  if (!value) return '--';
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const formatDuration = (value?: number) => {
  if (!value || value < 0) return '--';
  const totalSec = Math.floor(value / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
};

const statusClass = (status: OngoingMissionView['status']) => {
  if (status === 'running') return 'bg-status-active/20 text-status-active';
  if (status === 'paused') return 'bg-amber-500/20 text-amber-700';
  return 'bg-blue-500/20 text-blue-700';
};

type DockTab = 'ongoing' | 'start' | 'logs';
const ACTIVE_MISSION_STALE_MS = 120_000;

const isMissionFresh = (mission: OngoingMissionView, nowMs: number) => {
  const ts = mission.lastSeenTs ?? mission.updatedAt;
  if (!ts) return true;
  return nowMs - ts <= ACTIVE_MISSION_STALE_MS;
};

export function MissionDock({
  robots,
  missions,
  ongoingMissions,
  missionLogs,
  focusedMission,
  selectedRobotId,
  startRobotId,
  startMissionId,
  pendingStart,
  pendingPhase,
  pendingMessage,
  onSetStartRobot,
  onSetStartMission,
  onShowUp,
  onConfirmStart,
  onCancelStart,
  onFocusMission,
  onClearFocus,
  onPauseMission,
  onResumeMission,
  onCancelMission,
}: MissionDockProps) {
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<DockTab>('ongoing');
  const [clockNowMs, setClockNowMs] = useState(() => Date.now());

  useEffect(() => {
    const shouldTick = expanded || ongoingMissions.length > 0;
    if (!shouldTick) return;
    const timer = setInterval(() => setClockNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expanded, ongoingMissions.length]);

  const robotsWithMap = useMemo(() => robots.filter(robot => Boolean(robot.mapId)), [robots]);
  const missionMapNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const mission of missions) {
      if (!map.has(mission.mapId)) {
        map.set(mission.mapId, mission.mapName);
      }
    }
    return map;
  }, [missions]);
  const ongoingMissionByRobotId = useMemo(() => {
    const map = new Map<string, OngoingMissionView>();
    for (const mission of ongoingMissions) {
      if (!map.has(mission.robotId)) {
        map.set(mission.robotId, mission);
      }
    }
    return map;
  }, [ongoingMissions]);
  const orderedStartRobots = useMemo(() => {
    const sorted = [...robotsWithMap];
    sorted.sort((left, right) => {
      const leftPinned = selectedRobotId !== null && selectedRobotId === left.id ? 1 : 0;
      const rightPinned = selectedRobotId !== null && selectedRobotId === right.id ? 1 : 0;
      if (leftPinned !== rightPinned) return rightPinned - leftPinned;
      return left.name.localeCompare(right.name);
    });
    return sorted;
  }, [robotsWithMap, selectedRobotId]);
  const effectiveStartRobotId = startRobotId ?? selectedRobotId ?? null;
  const selectedStartRobot =
    effectiveStartRobotId !== null
      ? (robots.find(robot => robot.id === effectiveStartRobotId) ?? null)
      : null;
  const startMissionOptions = useMemo(() => {
    if (!selectedStartRobot?.mapId) return [];
    return missions
      .filter(mission => mission.mapId === selectedStartRobot.mapId)
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [missions, selectedStartRobot?.mapId]);
  const selectedStartMission =
    startMissionId !== null
      ? (startMissionOptions.find(m => m.id === startMissionId) ?? null)
      : null;
  const selectedRobotOngoingMission =
    selectedStartRobot !== null
      ? (ongoingMissionByRobotId.get(selectedStartRobot.id) ?? null)
      : null;
  const selectedRobotEmergencyActive =
    selectedStartRobot !== null ? isRobotEmergencyActive(selectedStartRobot) : false;
  const nowMs = Date.now();
  const selectedRobotHasCurrentPreviewSelection =
    selectedRobotOngoingMission?.status === 'showing' &&
    ((selectedStartMission?.id !== null &&
      selectedStartMission?.id !== undefined &&
      selectedRobotOngoingMission?.missionId === selectedStartMission.id) ||
      (pendingStart?.robotId === selectedStartRobot?.id &&
        pendingStart?.mission.id === selectedRobotOngoingMission?.missionId));
  const selectedRobotBlockingMission =
    selectedRobotOngoingMission &&
    (selectedRobotOngoingMission.status === 'running' ||
      selectedRobotOngoingMission.status === 'paused') &&
    isMissionFresh(selectedRobotOngoingMission, nowMs) &&
    !selectedRobotHasCurrentPreviewSelection
      ? selectedRobotOngoingMission
      : null;

  const summaryMission =
    focusedMission !== null
      ? (ongoingMissions.find(
          mission =>
            mission.robotId === focusedMission.robotId &&
            (focusedMission.missionId ? mission.missionId === focusedMission.missionId : true)
        ) ?? ongoingMissions[0])
      : ongoingMissions[0];
  const summaryMissionRobot =
    summaryMission !== undefined && summaryMission !== null
      ? (robots.find(robot => robot.id === summaryMission.robotId) ?? null)
      : null;
  const summaryMissionEmergencyActive =
    summaryMissionRobot !== null ? isRobotEmergencyActive(summaryMissionRobot) : false;

  const focusedMissionMeta =
    focusedMission !== null
      ? (missions.find(
          mission =>
            mission.id === focusedMission.missionId &&
            (!mission.mapId ||
              mission.mapId === robots.find(r => r.id === focusedMission.robotId)?.mapId)
        ) ?? missions.find(mission => mission.id === focusedMission.missionId))
      : null;

  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 pointer-events-none p-2 md:p-3">
      <div className="pointer-events-auto rounded-xl border border-border bg-card/95 shadow-2xl backdrop-blur">
        <div
          className={cn(
            'relative flex items-center gap-3 px-3 py-2 border-b border-border/60',
            !expanded && 'cursor-pointer'
          )}
        >
          {!expanded && (
            <button
              type="button"
              aria-label="Expand mission dock"
              className="absolute inset-0 z-0"
              onClick={() => setExpanded(true)}
            />
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(value => !value)}
            className="relative z-20 h-8 px-2 pointer-events-auto"
          >
            {expanded ? (
              <>
                <ChevronDown className="h-4 w-4 mr-1.5" />
                Collapse
              </>
            ) : (
              <>
                <ChevronUp className="h-4 w-4 mr-1.5" />
                Expand
              </>
            )}
          </Button>

          <div className="relative z-10 flex-1 min-w-0 text-sm pointer-events-none">
            {summaryMission ? (
              <div className="flex items-center gap-2 overflow-hidden">
                <span className="font-semibold truncate pointer-events-auto">
                  {summaryMission.missionName}
                </span>
                <span
                  className={cn(
                    'px-2 py-0.5 rounded-full text-xs pointer-events-auto',
                    statusClass(summaryMission.status)
                  )}
                >
                  {summaryMission.status.toUpperCase()}
                </span>
                <span className="text-muted-foreground truncate pointer-events-auto">
                  {summaryMission.robotName}
                </span>
                <span className="text-muted-foreground pointer-events-auto">
                  {summaryMission.waypointIndex ?? 0}/{summaryMission.totalWaypoints ?? 0}
                </span>
                <span className="text-muted-foreground pointer-events-auto">
                  {formatDuration(
                    summaryMission.startedAt
                      ? clockNowMs - summaryMission.startedAt
                      : summaryMission.elapsedMs
                  )}
                </span>
              </div>
            ) : (
              <span className="text-muted-foreground pointer-events-auto">No ongoing missions</span>
            )}
          </div>

          {summaryMission && (
            <div className="relative z-10 flex items-center gap-1 pointer-events-none">
              {summaryMission.status === 'paused' ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 pointer-events-auto"
                  onClick={() => onResumeMission(summaryMission.robotId, summaryMission.missionId)}
                  disabled={summaryMissionEmergencyActive}
                >
                  <Play className="h-3.5 w-3.5 mr-1" />
                  Resume
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 pointer-events-auto"
                  onClick={() => onPauseMission(summaryMission.robotId, summaryMission.missionId)}
                  disabled={summaryMissionEmergencyActive}
                >
                  <Pause className="h-3.5 w-3.5 mr-1" />
                  Pause
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="destructive"
                className="h-8 pointer-events-auto"
                onClick={() => onCancelMission(summaryMission.robotId, summaryMission.missionId)}
                disabled={summaryMissionEmergencyActive}
              >
                <XCircle className="h-3.5 w-3.5 mr-1" />
                Cancel
              </Button>
            </div>
          )}
        </div>

        {expanded && (
          <div className="max-h-[45vh] overflow-y-auto">
            <div className="flex items-center gap-1 px-3 pt-3">
              <DockTabButton active={tab === 'ongoing'} onClick={() => setTab('ongoing')}>
                Ongoing
              </DockTabButton>
              <DockTabButton active={tab === 'start'} onClick={() => setTab('start')}>
                Start Mission
              </DockTabButton>
              <DockTabButton active={tab === 'logs'} onClick={() => setTab('logs')}>
                Logs
              </DockTabButton>
            </div>

            {tab === 'ongoing' && (
              <div className="p-3 space-y-3">
                {focusedMissionMeta && focusedMission && (
                  <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold">{focusedMissionMeta.name}</div>
                      <Button type="button" size="sm" variant="outline" onClick={onClearFocus}>
                        Clear Focus
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {focusedMissionMeta.steps.map((step, idx) => {
                        const label =
                          focusedMissionMeta.locationTags.find(
                            tag => String(tag.id) === String(step)
                          )?.name ?? String(step);
                        const focused = ongoingMissions.find(
                          mission =>
                            mission.robotId === focusedMission.robotId &&
                            mission.missionId === focusedMission.missionId
                        );
                        const current = focused?.waypointIndex ?? 0;
                        const stepNum = idx + 1;
                        const isDone = current > 0 && stepNum < current;
                        const isCurrent = current > 0 && stepNum === current;
                        return (
                          <span
                            key={`${focusedMissionMeta.id}-${step}-${idx}`}
                            className={cn(
                              'px-2 py-1 rounded-full text-xs border',
                              isDone &&
                                'bg-status-active/15 text-status-active border-status-active/40',
                              isCurrent && 'bg-blue-500/15 text-blue-700 border-blue-500/40',
                              !isDone &&
                                !isCurrent &&
                                'bg-background text-muted-foreground border-border'
                            )}
                          >
                            {isDone ? '✓ ' : isCurrent ? '▶ ' : '○ '}
                            {label}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}

                {ongoingMissions.length === 0 && (
                  <div className="text-sm text-muted-foreground">No ongoing missions.</div>
                )}

                {ongoingMissions.map(mission => {
                  const isFocused =
                    focusedMission !== null &&
                    focusedMission.robotId === mission.robotId &&
                    (focusedMission.missionId
                      ? focusedMission.missionId === mission.missionId
                      : true);
                  const pinned = selectedRobotId !== null && selectedRobotId === mission.robotId;
                  return (
                    <div
                      key={`${mission.robotId}:${mission.missionId ?? 'unknown'}`}
                      className={cn(
                        'rounded-lg border p-3 space-y-2',
                        isFocused
                          ? 'border-status-active/50 bg-status-active/5'
                          : 'border-border bg-muted/20'
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold truncate">
                            {mission.missionName}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {mission.robotName}
                            {pinned ? ' • selected robot' : ''}
                            {mission.mapName ? ` • ${mission.mapName}` : ''}
                          </div>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant={isFocused ? 'default' : 'outline'}
                          onClick={() => onFocusMission(mission.robotId, mission.missionId)}
                        >
                          <Target className="h-3.5 w-3.5 mr-1" />
                          Focus
                        </Button>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span
                          className={cn('px-2 py-0.5 rounded-full', statusClass(mission.status))}
                        >
                          {mission.status.toUpperCase()}
                        </span>
                        <span className="text-muted-foreground">
                          {mission.waypointIndex ?? 0}/{mission.totalWaypoints ?? 0}
                        </span>
                        <span className="text-muted-foreground">
                          {formatDuration(
                            mission.startedAt ? clockNowMs - mission.startedAt : mission.elapsedMs
                          )}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {tab === 'start' && (
              <div className="p-3 space-y-3">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
                  <div className="lg:col-span-4 rounded-lg border border-border bg-muted/20 p-3 space-y-2">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      1. Select Robot
                    </div>
                    {orderedStartRobots.length === 0 ? (
                      <div className="text-sm text-muted-foreground">
                        No robots with map assignment.
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                        {orderedStartRobots.map(robot => {
                          const isSelected = selectedStartRobot?.id === robot.id;
                          const isPinned = selectedRobotId !== null && selectedRobotId === robot.id;
                          const activeMission = ongoingMissionByRobotId.get(robot.id) ?? null;
                          const emergencyActive = isRobotEmergencyActive(robot);
                          const isBusy =
                            activeMission !== null &&
                            (activeMission.status === 'running' ||
                              activeMission.status === 'paused') &&
                            isMissionFresh(activeMission, nowMs);
                          const mapLabel = robot.mapId
                            ? (missionMapNameById.get(robot.mapId) ?? robot.mapId)
                            : 'No map';
                          const runtimeLabel = getRobotDisplayStatusLabel(robot);

                          return (
                            <button
                              key={robot.id}
                              type="button"
                              className={cn(
                                'w-full rounded-md border px-3 py-2 text-left transition-colors',
                                isSelected
                                  ? 'border-status-active/50 bg-status-active/10'
                                  : 'border-border bg-background hover:bg-muted/60'
                              )}
                              onClick={() => onSetStartRobot(robot.id)}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-semibold truncate">{robot.name}</span>
                                {isPinned && (
                                  <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-primary/15 text-primary">
                                    Selected
                                  </span>
                                )}
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground truncate">
                                {mapLabel}
                              </div>
                              <div className="mt-2 flex items-center gap-2 text-[11px]">
                                <span className="px-1.5 py-0.5 rounded-full bg-muted text-foreground">
                                  {runtimeLabel}
                                </span>
                                <span
                                  className={cn(
                                    'px-1.5 py-0.5 rounded-full',
                                    emergencyActive
                                      ? 'bg-status-error/20 text-status-error'
                                      : isBusy
                                        ? 'bg-amber-500/20 text-amber-700'
                                        : 'bg-status-active/20 text-status-active'
                                  )}
                                >
                                  {emergencyActive ? 'Emergency' : isBusy ? 'Busy' : 'Available'}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="lg:col-span-8 rounded-lg border border-border bg-muted/20 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        2. Select Mission
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {selectedStartRobot
                          ? `${selectedStartRobot.name} • ${
                              selectedStartRobot.mapId
                                ? (missionMapNameById.get(selectedStartRobot.mapId) ??
                                  selectedStartRobot.mapId)
                                : 'No map'
                            }`
                          : 'Select a robot first'}
                      </div>
                    </div>

                    {selectedStartRobot ? (
                      selectedRobotEmergencyActive ? (
                        <div className="rounded-md border border-status-error/40 bg-status-error/10 p-3 text-sm text-status-error">
                          {selectedStartRobot.name} is in emergency stop. Clear emergency before
                          starting or previewing a mission.
                        </div>
                      ) : selectedRobotBlockingMission ? (
                        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800">
                          {selectedStartRobot.name}{' '}
                          {selectedRobotBlockingMission.status === 'paused'
                            ? 'has a paused mission'
                            : selectedRobotBlockingMission.status === 'showing'
                              ? 'already has a mission preview open for'
                              : 'is already running'}{' '}
                          <span className="font-semibold">
                            {selectedRobotBlockingMission.missionName}
                          </span>
                          . Resolve it from Ongoing before starting another mission.
                        </div>
                      ) : startMissionOptions.length === 0 ? (
                        <div className="text-sm text-muted-foreground">
                          No missions available for this robot's map.
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {startMissionOptions.map(mission => {
                            const isSelected = selectedStartMission?.id === mission.id;
                            const isPending =
                              pendingStart?.robotId === selectedStartRobot.id &&
                              pendingStart.mission.id === mission.id;

                            return (
                              <button
                                key={`${mission.mapId}:${mission.id}`}
                                type="button"
                                className={cn(
                                  'rounded-md border px-3 py-2 text-left transition-colors',
                                  isPending
                                    ? 'border-status-active/60 bg-status-active/10'
                                    : isSelected
                                      ? 'border-primary/40 bg-primary/5'
                                      : 'border-border bg-background hover:bg-muted/60'
                                )}
                                onClick={() => {
                                  onSetStartMission(mission.id);
                                  if (!isPending) {
                                    onShowUp(selectedStartRobot.id, mission.id);
                                  }
                                }}
                                disabled={false}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="text-sm font-semibold truncate">
                                    {mission.name}
                                  </div>
                                  {isPending ? (
                                    <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-status-active/20 text-status-active">
                                      {pendingPhase === 'preview_pending'
                                        ? 'Sending'
                                        : pendingPhase === 'start_pending'
                                          ? 'Starting'
                                          : 'Ready'}
                                    </span>
                                  ) : (
                                    isSelected && (
                                      <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-primary/15 text-primary">
                                        Selected
                                      </span>
                                    )
                                  )}
                                </div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {mission.steps.length} waypoint
                                  {mission.steps.length === 1 ? '' : 's'}
                                </div>
                                <div className="mt-1 text-xs text-muted-foreground truncate">
                                  {mission.mapName}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )
                    ) : (
                      <div className="text-sm text-muted-foreground">
                        Select a robot to load missions for its map.
                      </div>
                    )}
                  </div>
                </div>

                {pendingStart && (
                  <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
                    <div className="text-sm font-semibold">
                      Ready to start {pendingStart.mission.name} on{' '}
                      {robots.find(robot => robot.id === pendingStart.robotId)?.name ??
                        pendingStart.robotId}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {pendingPhase === 'preview_pending'
                        ? (pendingMessage ?? 'SHOW_UP sent... waiting for robot')
                        : pendingPhase === 'start_pending'
                          ? (pendingMessage ?? 'Starting... waiting for robot ack')
                          : pendingPhase === 'showing'
                            ? (pendingMessage ?? 'Ready to start')
                            : (pendingMessage ?? 'Ready to start')}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        className="flex-1"
                        onClick={onConfirmStart}
                        disabled={
                          selectedRobotEmergencyActive ||
                          pendingPhase === 'preview_pending' ||
                          pendingPhase === 'start_pending'
                        }
                      >
                        {pendingPhase === 'start_pending' ? 'Starting...' : 'Confirm Start'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="flex-1"
                        onClick={onCancelStart}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab === 'logs' && (
              <div className="p-3 space-y-2">
                {missionLogs.length === 0 && (
                  <div className="text-sm text-muted-foreground">
                    No completed/failed missions yet.
                  </div>
                )}
                {missionLogs.map(log => (
                  <div
                    key={log.id}
                    className="rounded-lg border border-border bg-muted/20 p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{log.missionName}</div>
                        <div className="text-xs text-muted-foreground">{log.robotName}</div>
                      </div>
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded-full text-xs inline-flex items-center gap-1',
                          log.result === 'completed'
                            ? 'bg-status-active/20 text-status-active'
                            : 'bg-status-error/20 text-status-error'
                        )}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {log.result.toUpperCase()}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground grid grid-cols-1 md:grid-cols-2 gap-1">
                      <div>Started: {formatDateTime(log.startedAt)}</div>
                      <div>Ended: {formatDateTime(log.endedAt)}</div>
                      <div>Duration: {formatDuration(log.durationMs)}</div>
                      <div>
                        Waypoints: {log.waypointIndex ?? 0}/{log.totalWaypoints ?? 0}
                      </div>
                    </div>
                    {log.message && (
                      <div className="text-xs text-muted-foreground">{log.message}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DockTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <Button type="button" size="sm" variant={active ? 'default' : 'outline'} onClick={onClick}>
      {children}
    </Button>
  );
}
