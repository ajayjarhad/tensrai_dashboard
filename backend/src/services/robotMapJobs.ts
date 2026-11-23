import { isMissionActivePhase } from '@tensrai/shared';
import { renderKeepoutMask } from './keepoutMask.js';
import { pgmOf } from './mapImage.js';
import { deleteMap, type MapBridgeTarget, putMap, RobotMapError } from './mapPush.js';
import type { MapSyncHost } from './mapRecords.js';
import { yamlTextOf } from './mapUpload.js';
import { getMissionState } from './missionStatus.js';
import { isAddressApproved } from './robotAddress.js';
import { toRobotMetadata } from './robotMetadata.js';
import { importFromRobot } from './saveMapFromMapping.js';

// Map operations that talk to a robot run here, in the background: the request returns at once and
// GET /maps reports progress, because nginx cuts a request off after 60 s and an import over a weak
// link can take longer. One operation per robot at a time.
// ponytail: state lives in memory, which works because there is one backend. After a restart the
// stored revisions still say which robots need a sync.

export type RobotMapJobKind = 'assign' | 'push' | 'unassign' | 'resolve';
export type RobotMapJobPhase = 'importing' | 'sending' | 'removing';

export interface RobotMapJob {
  kind: RobotMapJobKind;
  robotId: string;
  mapIds: string[];
  // The map being worked on now.
  mapId: string;
  phase: RobotMapJobPhase;
  startedAt: number;
}

export interface RobotMapOutcome {
  state: 'failed' | 'unsupported' | 'conflict';
  error?: string;
  at: number;
}

const jobs = new Map<string, RobotMapJob>();
const outcomes = new Map<string, RobotMapOutcome>();
const unsupportedRobots = new Set<string>();
const outcomeKey = (robotId: string, mapId: string) => `${robotId}:${mapId}`;

export const robotJob = (robotId: string) => jobs.get(robotId);
export const robotMapOutcome = (robotId: string, mapId: string) =>
  outcomes.get(outcomeKey(robotId, mapId));
export const robotCannotReceiveMaps = (robotId: string) => unsupportedRobots.has(robotId);

export type JobRefusalCode =
  | 'ROBOT_BUSY'
  | 'MISSION_RUNNING'
  | 'NO_MAPPING_BRIDGE'
  | 'ADDRESS_NOT_APPROVED';

export class RobotJobRefused extends Error {
  constructor(
    readonly code: JobRefusalCode,
    message: string,
    readonly status = 409
  ) {
    super(message);
  }
}

const missionRunning = (robotId: string) => isMissionActivePhase(getMissionState(robotId).phase);

export interface JobRobot {
  id: string;
  orgId: string;
  name: string;
  ipAddress: string | null;
  mappingBridgePort: number | null;
}

// Everything that can refuse a job without talking to the robot, so the request fails at once.
export const checkRobotCanTakeMaps = async (host: MapSyncHost, robot: JobRobot) => {
  if (!robot.ipAddress || !robot.mappingBridgePort) {
    throw new RobotJobRefused('NO_MAPPING_BRIDGE', 'This robot has no mapping bridge set up.', 400);
  }
  if (!(await isAddressApproved(host.prisma, robot))) {
    throw new RobotJobRefused(
      'ADDRESS_NOT_APPROVED',
      "This robot's address is waiting for approval."
    );
  }
  if (jobs.has(robot.id)) {
    throw new RobotJobRefused(
      'ROBOT_BUSY',
      'The robot is busy with another map operation. Try again shortly.'
    );
  }
  if (missionRunning(robot.id)) {
    throw new RobotJobRefused(
      'MISSION_RUNNING',
      'The robot is running a mission. Sync when it has finished.'
    );
  }
};

export type JobAudit = (action: string, metadata: Record<string, unknown>) => Promise<void> | void;

export interface JobContext {
  host: MapSyncHost;
  robot: JobRobot;
  job: RobotMapJob;
  audit: JobAudit;
}

const recordOutcome = (robotId: string, mapId: string, error: unknown) => {
  if (error instanceof RobotMapError && error.kind === 'unsupported') {
    unsupportedRobots.add(robotId);
    outcomes.set(outcomeKey(robotId, mapId), {
      state: 'unsupported',
      error: "This robot's software can't receive maps yet.",
      at: Date.now(),
    });
    return;
  }
  outcomes.set(outcomeKey(robotId, mapId), {
    state: 'failed',
    error: error instanceof Error ? error.message : 'The sync failed.',
    at: Date.now(),
  });
};

// Runs `work` in the background with the robot's lock held. Checks run first, so a refusal is the
// request's answer; anything later lands in the robot's state on the Maps page.
export const startRobotJob = async (
  host: MapSyncHost,
  robot: JobRobot,
  kind: RobotMapJobKind,
  mapIds: string[],
  audit: JobAudit,
  work: (context: JobContext) => Promise<void>
) => {
  await checkRobotCanTakeMaps(host, robot);
  const [first] = mapIds;
  if (!first) return null;
  const job: RobotMapJob = {
    kind,
    robotId: robot.id,
    mapIds,
    mapId: first,
    phase: 'importing',
    startedAt: Date.now(),
  };
  jobs.set(robot.id, job);
  for (const mapId of mapIds) outcomes.delete(outcomeKey(robot.id, mapId));
  void (async () => {
    const started = Date.now();
    try {
      await work({ host, robot, job, audit });
      host.log.info(
        { robotId: robot.id, kind, mapIds, ms: Date.now() - started },
        'Robot map job done'
      );
    } catch (error) {
      recordOutcome(robot.id, job.mapId, error);
      host.log.warn(
        { robotId: robot.id, kind, mapId: job.mapId, ms: Date.now() - started, err: error },
        'Robot map job failed'
      );
    } finally {
      jobs.delete(robot.id);
    }
  })();
  return job;
};

const bridgeOf = (robot: JobRobot): MapBridgeTarget => ({
  url: `ws://${robot.ipAddress}:${robot.mappingBridgePort}`,
});

export const stemOf = (filename: string) => filename.replace(/\.ya?ml$/i, '');

// Robots discover maps by globbing map*.yaml, so every stem starts with "map".
export const freeStem = (taken: Set<string>, preferred: string) => {
  if (/^map[\w-]*$/.test(preferred) && !taken.has(preferred)) return preferred;
  for (let n = 1; ; n += 1) if (!taken.has(`map${n}`)) return `map${n}`;
};

// Tags and missions are still authored on robots: a sync first brings the robot's copies in, so a
// change made there is never overwritten without anyone seeing it.
const importFirst = async ({ host, robot, job }: JobContext, acceptRobotMapId?: string) => {
  job.phase = 'importing';
  const status = await importFromRobot(host, robot, { acceptRobotMapId });
  // A robot with no maps yet has nothing to import, which is no reason to stop.
  if (status.phase === 'failed' && !/no map files/i.test(status.lastError ?? '')) {
    throw new RobotMapError('unreachable', status.lastError ?? "Couldn't read the robot's maps.");
  }
};

const loadMap = async ({ host }: JobContext, mapId: string) => {
  const map = await host.prisma.map.findUnique({
    where: { id: mapId },
    select: {
      id: true,
      filename: true,
      revision: true,
      image: true,
      metadata: true,
      features: true,
      pixelWidth: true,
      pixelHeight: true,
    },
  });
  if (!map) throw new RobotMapError('rejected', 'The map was deleted.');
  return map;
};

type LoadedMap = Awaited<ReturnType<typeof loadMap>>;

const sendMap = async (
  context: JobContext,
  map: LoadedMap,
  stem: string,
  mode: 'create' | 'replace'
) => {
  if (missionRunning(context.robot.id)) {
    throw new RobotMapError('rejected', 'The robot started a mission. Sync when it has finished.');
  }
  context.job.phase = 'sending';
  const metadata = (map.metadata ?? {}) as Record<string, unknown>;
  const origin = Array.isArray(metadata['origin']) ? (metadata['origin'] as number[]) : [0, 0, 0];
  const keepout = renderKeepoutMask(
    {
      width: map.pixelWidth ?? 0,
      height: map.pixelHeight ?? 0,
      resolution: Number(metadata['resolution'] ?? 0.05),
      origin: [Number(origin[0] ?? 0), Number(origin[1] ?? 0), 0],
    },
    map.features,
    stem
  );
  const ack = await putMap(bridgeOf(context.robot), {
    mode,
    stem,
    yamlText: yamlTextOf({ ...metadata, image: `${stem}.pgm` }),
    pgm: pgmOf(map.image),
    metadata: toRobotMetadata(map.features),
    keepout,
  });
  if (ack.status === 'error') {
    throw new RobotMapError('rejected', ack.message ?? 'The robot refused the map.');
  }
  return ack.status;
};

// The revision recorded is the one that was sent: an edit saved meanwhile shows as needing a sync.
const recordHolds = (context: JobContext, map: LoadedMap, filename: string) =>
  context.host.prisma.robotMap.update({
    where: { robotId_mapId: { robotId: context.robot.id, mapId: map.id } },
    data: { filename, pushedRevision: map.revision, conflictRevision: null, syncedAt: new Date() },
  });

const pushOne = async (context: JobContext, mapId: string, force: boolean) => {
  context.job.mapId = mapId;
  const { robot, host } = context;
  const link = await host.prisma.robotMap.findUnique({
    where: { robotId_mapId: { robotId: robot.id, mapId } },
    select: { filename: true, conflictRevision: true },
  });
  if (!link) throw new RobotMapError('rejected', 'The robot no longer holds this map.');
  if (link.conflictRevision && !force) {
    outcomes.set(outcomeKey(robot.id, mapId), { state: 'conflict', at: Date.now() });
    return;
  }
  const map = await loadMap(context, mapId);
  const filename = link.filename ?? map.filename;
  await sendMap(context, map, stemOf(filename), 'replace');
  await recordHolds(context, map, filename);
  unsupportedRobots.delete(robot.id);
  await context.audit('MAP_PUSHED', { mapId, robotId: robot.id, revision: map.revision });
};

// Sync: the latest saved version of each map to this robot.
export const pushMaps =
  (mapIds: string[], force = false) =>
  async (context: JobContext) => {
    await importFirst(context);
    for (const mapId of mapIds) await pushOne(context, mapId, force);
  };

// Assign: a new file on the robot, under the map's own filename or the next free map<N>.
export const assignMap = (mapId: string) => async (context: JobContext) => {
  const { host, robot } = context;
  await importFirst(context);
  const linked = await host.prisma.robotMap.findUnique({
    where: { robotId_mapId: { robotId: robot.id, mapId } },
    select: { mapId: true },
  });
  if (linked) {
    await pushOne(context, mapId, false);
    return;
  }
  const map = await loadMap(context, mapId);
  const links = await host.prisma.robotMap.findMany({
    where: { robotId: robot.id },
    select: { filename: true, map: { select: { filename: true } } },
  });
  const taken = new Set(links.map(link => stemOf(link.filename ?? link.map?.filename ?? '')));
  // A stem the robot holds but the dashboard doesn't know about answers "exists": import, try the next.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const stem = freeStem(taken, stemOf(map.filename));
    if ((await sendMap(context, map, stem, 'create')) === 'stored') {
      await host.prisma.robotMap.create({
        data: {
          orgId: robot.orgId,
          robotId: robot.id,
          mapId,
          isActive: false,
          isPinned: false,
          filename: `${stem}.yaml`,
          pushedRevision: map.revision,
        },
      });
      unsupportedRobots.delete(robot.id);
      await context.audit('MAP_ASSIGNED', {
        mapId,
        robotId: robot.id,
        revision: map.revision,
        stem,
      });
      return;
    }
    taken.add(stem);
    await importFirst(context);
  }
  throw new RobotMapError('rejected', "Couldn't find a free file name on the robot.");
};

// Unassign: the file leaves the robot, then the link leaves the dashboard.
export const unassignMap = (mapId: string) => async (context: JobContext) => {
  const { host, robot } = context;
  await importFirst(context);
  const link = await host.prisma.robotMap.findUnique({
    where: { robotId_mapId: { robotId: robot.id, mapId } },
    select: { filename: true, map: { select: { filename: true } } },
  });
  if (!link) return;
  context.job.phase = 'removing';
  const ack = await deleteMap(bridgeOf(robot), stemOf(link.filename ?? link.map?.filename ?? ''));
  if (ack.status !== 'deleted') {
    throw new RobotMapError('rejected', ack.message ?? 'The robot refused to delete the map.');
  }
  await host.prisma.robotMap.delete({ where: { robotId_mapId: { robotId: robot.id, mapId } } });
  await context.audit('MAP_UNASSIGNED', { mapId, robotId: robot.id, stem: link.filename });
};

// Resolve a conflict: send ours over the robot's change, or take the robot's copy once.
export const resolveConflict =
  (mapId: string, keep: 'dashboard' | 'robot') => async (context: JobContext) => {
    if (keep === 'dashboard') {
      await pushMaps([mapId], true)(context);
    } else {
      await importFirst(context, mapId);
    }
    await context.audit('MAP_CONFLICT_RESOLVED', { mapId, robotId: context.robot.id, keep });
  };

// Robots this map is on its way to, or failed to reach: an assignment has no link until the robot
// stores the map, but its progress and failure belong on the Maps page all the same.
export const assignmentsInFlight = (mapId: string) => {
  const pending: {
    robotId: string;
    state: MapRobotState;
    error?: string;
    phase?: RobotMapJobPhase;
  }[] = [];
  for (const job of jobs.values()) {
    if (job.kind === 'assign' && job.mapIds.includes(mapId)) {
      pending.push({ robotId: job.robotId, state: 'syncing', phase: job.phase });
    }
  }
  for (const [key, outcome] of outcomes) {
    const [robotId, outcomeMapId] = key.split(':');
    if (outcomeMapId !== mapId || !robotId || outcome.state === 'conflict') continue;
    if (pending.some(entry => entry.robotId === robotId)) continue;
    pending.push({
      robotId,
      state: outcome.state,
      ...(outcome.error ? { error: outcome.error } : {}),
    });
  }
  return pending;
};

// Dismisses an assignment the robot never took, so it leaves the Maps page.
export const forgetFailedAssignment = (robotId: string, mapId: string) =>
  !jobs.has(robotId) && outcomes.delete(outcomeKey(robotId, mapId));

// For tests: no job outlives its test.
export const resetRobotMapJobs = () => {
  jobs.clear();
  outcomes.clear();
  unsupportedRobots.clear();
};

export type MapRobotState =
  | 'synced'
  | 'needs_sync'
  | 'syncing'
  | 'failed'
  | 'conflict'
  | 'unsupported';

// What the Maps page shows for one robot holding one map.
export const robotStateFor = (
  link: {
    robotId: string;
    mapId: string;
    pushedRevision: string | null;
    conflictRevision: string | null;
  },
  map: { revision: string | null; editedAt: Date | null }
): { state: MapRobotState; error?: string; phase?: RobotMapJobPhase } => {
  const job = jobs.get(link.robotId);
  if (job?.mapIds.includes(link.mapId)) return { state: 'syncing', phase: job.phase };
  const outcome = outcomes.get(outcomeKey(link.robotId, link.mapId));
  if (link.conflictRevision) return { state: 'conflict' };
  if (outcome?.state === 'failed')
    return { state: 'failed', ...(outcome.error ? { error: outcome.error } : {}) };
  // A link from before revisions on a map never edited here holds the robot's own copy.
  const current = link.pushedRevision ? link.pushedRevision === map.revision : !map.editedAt;
  if (current) return { state: 'synced' };
  if (outcome?.state === 'unsupported' || unsupportedRobots.has(link.robotId)) {
    return { state: 'unsupported', error: "This robot's software can't receive maps yet." };
  }
  return { state: 'needs_sync' };
};
