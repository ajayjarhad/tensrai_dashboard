import type { FleetEmergencyDispatchResult } from '@tensrai/shared';
import { toast } from 'sonner';
import type { Robot } from '@/types/robot';

const formatRobotNames = (names: string[]) => {
  if (names.length === 0) return '';
  if (names.length <= 3) return names.join(', ');
  return `${names.slice(0, 3).join(', ')} +${names.length - 3} more`;
};

export const summarizeEmergency = (robots: Robot[]) => {
  let connectedRobots = 0;
  let softwareEmergencyCount = 0;
  let hardwareEmergencyCount = 0;
  let unknownCount = 0;
  let anyEmergencyActive = false;

  for (const robot of robots) {
    const state = robot.emergency;
    if (state?.effectiveEmergencyActive) {
      anyEmergencyActive = true;
    }
    if (!robot.ipAddress || !state || state.connectionStatus !== 'connected') {
      unknownCount += 1;
      continue;
    }

    connectedRobots += 1;
    if (state.hardwareEmergencyActive) {
      hardwareEmergencyCount += 1;
    } else if (state.softwareEmergencyActive) {
      softwareEmergencyCount += 1;
    }
  }

  return {
    totalRobots: robots.length,
    connectedRobots,
    softwareEmergencyCount,
    hardwareEmergencyCount,
    unknownCount,
    anyEmergencyActive,
  };
};

type FleetDispatchSummary = {
  status: FleetEmergencyDispatchResult['status'];
  successSummary: string;
  successCount: number;
  failureCount: number;
  failureDescription: string | undefined;
  hardwareLockedCount: number;
};

const pluralRobots = (count: number) => `${count} robot${count === 1 ? '' : 's'}`;

const summarizeFleetDispatch = (result: FleetEmergencyDispatchResult): FleetDispatchSummary => {
  const successfulNames = result.results
    .filter(entry => entry.applied)
    .map(entry => entry.robotName ?? entry.robotId);
  const successCount = result.results.filter(entry => entry.applied).length;
  const failureSummary = result.results
    .filter(entry => !entry.applied)
    .map(entry => `${entry.robotName ?? entry.robotId}: ${entry.error ?? 'unknown error'}`)
    .join('; ');
  return {
    status: result.status,
    successSummary: formatRobotNames(successfulNames),
    successCount,
    failureCount: result.results.length - successCount,
    failureDescription: failureSummary || undefined,
    hardwareLockedCount: result.results.filter(
      entry => entry.applied && entry.hardwareEmergencyActive
    ).length,
  };
};

const notifyEmergencySent = (summary: FleetDispatchSummary) => {
  const { status, successSummary, successCount, failureCount, failureDescription } = summary;
  if (status === 'success') {
    toast.success(
      successSummary
        ? `Emergency sent to ${successSummary}`
        : `Emergency sent to ${pluralRobots(successCount)}`
    );
    return;
  }
  if (status === 'partial_failure') {
    toast.error(
      successSummary
        ? `Emergency sent to ${successSummary}; ${failureCount} failed`
        : `Emergency sent to ${successCount} robots, ${failureCount} failed`,
      { description: failureDescription }
    );
    return;
  }
  toast.error('Emergency command failed for all robots', { description: failureDescription });
};

const notifyEmergencyReleased = (summary: FleetDispatchSummary) => {
  const { status, successSummary, successCount, failureCount, failureDescription } = summary;
  if (status === 'failure') {
    toast.error('Release command failed for all robots', { description: failureDescription });
    return;
  }
  if (summary.hardwareLockedCount > 0) {
    const stillStopped = pluralRobots(summary.hardwareLockedCount);
    toast.message(
      `Software emergency released; ${stillStopped} remain stopped due to hardware emergency`
    );
    return;
  }
  if (status === 'partial_failure') {
    toast.error(
      successSummary
        ? `Release sent to ${successSummary}; ${failureCount} failed`
        : `Release sent to ${successCount} robots, ${failureCount} failed`,
      { description: failureDescription }
    );
    return;
  }
  toast.success(
    successSummary
      ? `Release sent to ${successSummary}`
      : `Release sent to ${pluralRobots(successCount)}`
  );
};

export const notifyFleetEmergencyResult = (
  desiredStatus: boolean,
  result: FleetEmergencyDispatchResult
) => {
  const summary = summarizeFleetDispatch(result);
  if (desiredStatus) {
    notifyEmergencySent(summary);
  } else {
    notifyEmergencyReleased(summary);
  }
};
