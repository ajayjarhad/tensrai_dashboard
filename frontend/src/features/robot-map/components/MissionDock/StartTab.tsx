import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { getRobotDisplayStatusLabel, isRobotEmergencyActive } from '@/lib/robotStatus';
import { cn } from '@/lib/utils';
import type { Robot } from '@/types/robot';
import type { MissionWithContext } from '../../types';
import { robotHasMap } from '../../utils/mapSelection';
import type { MissionDockProps, OngoingMissionView } from './missionDockModel';

const ACTIVE_MISSION_STALE_MS = 120_000;

const isMissionFresh = (mission: OngoingMissionView, nowMs: number) => {
  const ts = mission.lastSeenTs ?? mission.updatedAt;
  if (!ts) return true;
  return nowMs - ts <= ACTIVE_MISSION_STALE_MS;
};

const isMissionBusy = (mission: OngoingMissionView | undefined, nowMs: number) =>
  mission !== undefined &&
  (mission.status === 'running' || mission.status === 'paused') &&
  isMissionFresh(mission, nowMs);

type PendingProps = Pick<MissionDockProps, 'pendingStart' | 'pendingPhase' | 'pendingMessage'>;

type StartTabProps = PendingProps &
  Pick<
    MissionDockProps,
    | 'robots'
    | 'missions'
    | 'ongoingMissions'
    | 'selectedRobotId'
    | 'startRobotId'
    | 'startMissionId'
    | 'onSetStartRobot'
    | 'onSetStartMission'
    | 'onShowUp'
    | 'onConfirmStart'
    | 'onCancelStart'
  >;

function RobotOption({
  robot,
  mapLabel,
  isSelected,
  isPinned,
  isBusy,
  onSelect,
}: {
  robot: Robot;
  mapLabel: string;
  isSelected: boolean;
  isPinned: boolean;
  isBusy: boolean;
  onSelect: () => void;
}) {
  const emergencyActive = isRobotEmergencyActive(robot);
  let availability = { label: 'Available', tone: 'bg-status-active/20 text-status-active' };
  if (emergencyActive) {
    availability = { label: 'Emergency', tone: 'bg-status-error/20 text-status-error' };
  } else if (isBusy) {
    availability = { label: 'Busy', tone: 'bg-amber-500/20 text-amber-700' };
  }

  return (
    <button
      type="button"
      className={cn(
        'w-full rounded-md border px-3 py-2 text-left transition-colors',
        isSelected
          ? 'border-status-active/50 bg-status-active/10'
          : 'border-border bg-background hover:bg-muted/60'
      )}
      onClick={onSelect}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold truncate">{robot.name}</span>
        {isPinned && (
          <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-primary/15 text-primary">
            Selected
          </span>
        )}
      </div>
      <div className="mt-1 text-xs text-muted-foreground truncate">{mapLabel}</div>
      <div className="mt-2 flex items-center gap-2 text-[11px]">
        <span className="px-1.5 py-0.5 rounded-full bg-muted text-foreground">
          {getRobotDisplayStatusLabel(robot)}
        </span>
        <span className={cn('px-1.5 py-0.5 rounded-full', availability.tone)}>
          {availability.label}
        </span>
      </div>
    </button>
  );
}

function MissionOption({
  mission,
  isSelected,
  isPending,
  onOtherMap,
  pendingPhase,
  onSelect,
}: {
  mission: MissionWithContext;
  isSelected: boolean;
  isPending: boolean;
  onOtherMap: boolean;
  pendingPhase: MissionDockProps['pendingPhase'];
  onSelect: () => void;
}) {
  const pendingLabel =
    pendingPhase === 'preview_pending'
      ? 'Sending'
      : pendingPhase === 'start_pending'
        ? 'Starting'
        : 'Ready';

  return (
    <button
      type="button"
      className={cn(
        'rounded-md border px-3 py-2 text-left transition-colors',
        isPending
          ? 'border-status-active/60 bg-status-active/10'
          : isSelected
            ? 'border-primary/40 bg-primary/5'
            : 'border-border bg-background hover:bg-muted/60',
        onOtherMap && 'cursor-not-allowed opacity-50 hover:bg-background'
      )}
      onClick={onSelect}
      disabled={onOtherMap}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold truncate">{mission.name}</div>
        {isPending ? (
          <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-status-active/20 text-status-active">
            {pendingLabel}
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
        {onOtherMap && ' · not the robot’s current map'}
      </div>
    </button>
  );
}

function PendingStartCard({
  pendingStart,
  robotName,
  pendingPhase,
  pendingMessage,
  confirmDisabled,
  onConfirmStart,
  onCancelStart,
}: Pick<
  MissionDockProps,
  'pendingPhase' | 'pendingMessage' | 'onConfirmStart' | 'onCancelStart'
> & {
  pendingStart: NonNullable<MissionDockProps['pendingStart']>;
  robotName: string;
  confirmDisabled: boolean;
}) {
  const phaseMessage =
    pendingPhase === 'preview_pending'
      ? 'SHOW_UP sent... waiting for robot'
      : pendingPhase === 'start_pending'
        ? 'Starting... waiting for robot ack'
        : 'Ready to start';

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
      <div className="text-sm font-semibold">
        Ready to start {pendingStart.mission.name} on {robotName}
      </div>
      <div className="text-xs text-muted-foreground">{pendingMessage ?? phaseMessage}</div>
      <div className="flex gap-2">
        <Button
          type="button"
          className="flex-1"
          onClick={onConfirmStart}
          disabled={confirmDisabled}
        >
          {pendingPhase === 'start_pending' ? 'Starting...' : 'Confirm Start'}
        </Button>
        <Button type="button" variant="outline" className="flex-1" onClick={onCancelStart}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function MissionPicker({
  robot,
  emergencyActive,
  blockingMission,
  options,
  selectedMissionId,
  pendingStart,
  pendingPhase,
  onSetStartMission,
  onShowUp,
}: Pick<MissionDockProps, 'pendingStart' | 'pendingPhase' | 'onSetStartMission' | 'onShowUp'> & {
  robot: Robot | null;
  emergencyActive: boolean;
  blockingMission: OngoingMissionView | null;
  options: MissionWithContext[];
  selectedMissionId: string | undefined;
}) {
  if (!robot) {
    return (
      <div className="text-sm text-muted-foreground">
        Select a robot to load missions for its map.
      </div>
    );
  }
  if (emergencyActive) {
    return (
      <div className="rounded-md border border-status-error/40 bg-status-error/10 p-3 text-sm text-status-error">
        {robot.name} is in emergency stop. Clear emergency before starting or previewing a mission.
      </div>
    );
  }
  if (blockingMission) {
    return (
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800">
        {robot.name}{' '}
        {blockingMission.status === 'paused' ? 'has a paused mission' : 'is already running'}{' '}
        <span className="font-semibold">{blockingMission.missionName}</span>. Resolve it from
        Ongoing before starting another mission.
      </div>
    );
  }
  if (options.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No missions available for this robot's map.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      {options.map(mission => {
        const isPending =
          pendingStart?.robotId === robot.id && pendingStart.mission.id === mission.id;
        return (
          <MissionOption
            key={`${mission.mapId}:${mission.id}`}
            mission={mission}
            isSelected={selectedMissionId === mission.id}
            isPending={isPending}
            // SHOW_UP carries only the mission id, so a robot can only preview its current map.
            onOtherMap={mission.mapId !== robot.mapId}
            pendingPhase={pendingPhase}
            onSelect={() => {
              onSetStartMission(mission.id);
              if (!isPending) onShowUp(robot.id, mission.id);
            }}
          />
        );
      })}
    </div>
  );
}

export function StartTab({
  robots,
  missions,
  ongoingMissions,
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
}: StartTabProps) {
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
  const orderedStartRobots = useMemo(
    () =>
      robots
        .filter(robot => Boolean(robot.mapId))
        .sort((left, right) => {
          const leftPinned = selectedRobotId === left.id ? 1 : 0;
          const rightPinned = selectedRobotId === right.id ? 1 : 0;
          if (leftPinned !== rightPinned) return rightPinned - leftPinned;
          return left.name.localeCompare(right.name);
        }),
    [robots, selectedRobotId]
  );

  const effectiveStartRobotId = startRobotId ?? selectedRobotId ?? null;
  const selectedStartRobot = robots.find(robot => robot.id === effectiveStartRobotId) ?? null;
  const startMissionOptions = useMemo(() => {
    if (!selectedStartRobot) return [];
    return missions
      .filter(mission => robotHasMap(selectedStartRobot, mission.mapId))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [missions, selectedStartRobot]);
  const selectedStartMission = startMissionOptions.find(m => m.id === startMissionId);
  const selectedRobotOngoingMission = selectedStartRobot
    ? ongoingMissionByRobotId.get(selectedStartRobot.id)
    : undefined;
  const selectedRobotEmergencyActive = selectedStartRobot
    ? isRobotEmergencyActive(selectedStartRobot)
    : false;
  const nowMs = Date.now();
  const selectedMapCount = selectedStartRobot?.maps?.length ?? 0;

  return (
    <div className="p-3 space-y-3">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div className="lg:col-span-4 rounded-lg border border-border bg-muted/20 p-3 space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            1. Select Robot
          </div>
          {orderedStartRobots.length === 0 ? (
            <div className="text-sm text-muted-foreground">No robots with map assignment.</div>
          ) : (
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {orderedStartRobots.map(robot => (
                <RobotOption
                  key={robot.id}
                  robot={robot}
                  mapLabel={
                    robot.mapId ? (missionMapNameById.get(robot.mapId) ?? robot.mapId) : 'No map'
                  }
                  isSelected={selectedStartRobot?.id === robot.id}
                  isPinned={selectedRobotId === robot.id}
                  isBusy={isMissionBusy(ongoingMissionByRobotId.get(robot.id), nowMs)}
                  onSelect={() => onSetStartRobot(robot.id)}
                />
              ))}
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
                ? `${selectedStartRobot.name} • ${selectedMapCount} map${selectedMapCount === 1 ? '' : 's'}`
                : 'Select a robot first'}
            </div>
          </div>

          <MissionPicker
            robot={selectedStartRobot}
            emergencyActive={selectedRobotEmergencyActive}
            blockingMission={
              selectedRobotOngoingMission && isMissionBusy(selectedRobotOngoingMission, nowMs)
                ? selectedRobotOngoingMission
                : null
            }
            options={startMissionOptions}
            selectedMissionId={selectedStartMission?.id}
            pendingStart={pendingStart}
            pendingPhase={pendingPhase}
            onSetStartMission={onSetStartMission}
            onShowUp={onShowUp}
          />
        </div>
      </div>

      {pendingStart && (
        <PendingStartCard
          pendingStart={pendingStart}
          robotName={
            robots.find(robot => robot.id === pendingStart.robotId)?.name ?? pendingStart.robotId
          }
          pendingPhase={pendingPhase}
          pendingMessage={pendingMessage}
          confirmDisabled={
            selectedRobotEmergencyActive ||
            pendingPhase === 'preview_pending' ||
            pendingPhase === 'start_pending'
          }
          onConfirmStart={onConfirmStart}
          onCancelStart={onCancelStart}
        />
      )}
    </div>
  );
}
