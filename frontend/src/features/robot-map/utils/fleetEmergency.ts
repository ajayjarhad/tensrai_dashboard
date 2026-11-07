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

export const notifyFleetEmergencyResult = (
  desiredStatus: boolean,
  result: FleetEmergencyDispatchResult
) => {
  const successfulNames = result.results
    .filter(entry => entry.applied)
    .map(entry => entry.robotName ?? entry.robotId);
  const successCount = result.results.filter(entry => entry.applied).length;
  const failureCount = result.results.length - successCount;
  const failureSummary = result.results
    .filter(entry => !entry.applied)
    .map(entry => `${entry.robotName ?? entry.robotId}: ${entry.error ?? 'unknown error'}`)
    .join('; ');
  const hardwareLockedCount = result.results.filter(
    entry => entry.applied && entry.hardwareEmergencyActive
  ).length;
  const successSummary = formatRobotNames(successfulNames);

  if (desiredStatus) {
    if (result.status === 'success') {
      toast.success(
        successSummary
          ? `Emergency sent to ${successSummary}`
          : `Emergency sent to ${successCount} robot${successCount === 1 ? '' : 's'}`
      );
    } else if (result.status === 'partial_failure') {
      toast.error(
        successSummary
          ? `Emergency sent to ${successSummary}; ${failureCount} failed`
          : `Emergency sent to ${successCount} robots, ${failureCount} failed`,
        {
          description: failureSummary || undefined,
        }
      );
    } else {
      toast.error('Emergency command failed for all robots', {
        description: failureSummary || undefined,
      });
    }
    return;
  }

  if (result.status === 'failure') {
    toast.error('Release command failed for all robots', {
      description: failureSummary || undefined,
    });
    return;
  }

  if (hardwareLockedCount > 0) {
    toast.message(
      `Software emergency released; ${hardwareLockedCount} robot${
        hardwareLockedCount === 1 ? '' : 's'
      } remain stopped due to hardware emergency`
    );
    return;
  }

  if (result.status === 'partial_failure') {
    toast.error(
      successSummary
        ? `Release sent to ${successSummary}; ${failureCount} failed`
        : `Release sent to ${successCount} robots, ${failureCount} failed`,
      {
        description: failureSummary || undefined,
      }
    );
    return;
  }

  toast.success(
    successSummary
      ? `Release sent to ${successSummary}`
      : `Release sent to ${successCount} robot${successCount === 1 ? '' : 's'}`
  );
};
