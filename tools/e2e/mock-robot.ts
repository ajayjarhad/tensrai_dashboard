// Protocol-accurate mock of one robot, written from dashboard_ros/mission_to_websockets:
//   9090 rosbridge, 8765 mapping (push_to_websockets.py), 9487 mission (mission_plan.py),
//   8766 emergency (emergency_flow.py), 9000 HTTP control channel for tests only.
// Timings and message wording match the Python. Faults are injected through the control channel.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const NAME = process.env.ROBOT_NAME ?? 'robot';
const MAP_DIR = process.env.MAP_DIR ?? '/maps';
const SWAP_MAPS = process.env.SWAP_MAPS === '1';
let WAYPOINT_MS = Number(process.env.WAYPOINT_MS ?? 1500);
const NAV_CANCEL_MS = 200;
const CONFIRM_TIMEOUT_MS = 3000;
const STATUS_PERIOD_MS = 30_000;
const CHUNK_BYTES = 16 * 1024;

const iso = () => new Date().toISOString();
const stamp = () => {
  const ms = Date.now();
  return { sec: Math.floor(ms / 1000), nanosec: (ms % 1000) * 1e6 };
};

type Sock = Bun.ServerWebSocket<{ port: number; subs: Map<string, string> }>;
const clients = new Map<number, Set<Sock>>([9090, 8765, 9487, 8766].map(port => [port, new Set()]));
const everConnected = new Map<number, number>([9090, 8765, 9487, 8766].map(port => [port, 0]));
const received = {
  cmdVel: [] as { t: number; msg: any }[],
  initialPose: [] as any[],
  advertised: [] as any[],
  subscribed: [] as any[],
  mission: [] as any[],
  emergency: [] as any[],
  mapping: [] as any[],
};
const faults = {
  refuse: false,
  laser: 'normal',
  failNext: false,
  noCancelConfirm: false,
  mapMode: process.env.MAP_CHUNKED === '1' ? 'chunked' : 'legacy',
  mapFault: 'none',
  mapHashes: {} as Record<string, string>,
};

const broadcast = (port: number, message: unknown) => {
  const text = typeof message === 'string' ? message : JSON.stringify(message);
  for (const ws of clients.get(port) ?? []) ws.send(text);
};

// ---- map files, as discover_map_sets() reads them ----
type MapSet = {
  name: string;
  map_yaml: string;
  map_pgm: string;
  map_yaml_content: string;
  map_pgm_content: string;
  metadata_json: any;
};
const stemFor = (stem: string) =>
  SWAP_MAPS ? (stem === 'map' ? 'map1' : stem === 'map1' ? 'map' : stem) : stem;
const loadMapSets = (): MapSet[] => {
  const stems = readdirSync(MAP_DIR)
    .filter(file => file.endsWith('.yaml'))
    .map(file => file.replace(/\.yaml$/, ''))
    .sort();
  return stems.map(stem => {
    const source = stemFor(stem);
    const suffix = source.replace(/^map/, '');
    const yaml = readFileSync(join(MAP_DIR, `${source}.yaml`), 'utf8').replace(
      `${source}.pgm`,
      `${stem}.pgm`
    );
    return {
      name: stem,
      map_yaml: `${stem}.yaml`,
      map_pgm: `${stem}.pgm`,
      map_yaml_content: yaml,
      map_pgm_content: readFileSync(join(MAP_DIR, `${source}.pgm`)).toString('base64'),
      metadata_json: JSON.parse(readFileSync(join(MAP_DIR, `metadata${suffix}.json`), 'utf8')),
    };
  });
};

const mainMapSet = (sets: MapSet[]) => sets.find(set => set.name === 'map') ?? sets[0];

const handleMappingLegacy = (ws: Sock) => {
  const sets = loadMapSets();
  const main = mainMapSet(sets);
  if (!main || faults.mapFault === 'nofiles') {
    ws.send(
      JSON.stringify({
        event: 'MAP_DATA_RESPONSE',
        payload: { files: null, error: 'No map files found' },
      })
    );
    return;
  }
  const others = sets.filter(set => set !== main);
  const corrupt: Record<string, object> = {
    badpgm: { map_pgm_content: Buffer.from('this is not a pgm').toString('base64') },
    notbase64: { map_pgm_content: '%%% not base64 %%%' },
    badyaml: { map_yaml_content: ': : : [not yaml' },
    badmeta: { metadata_json: { missions: 'x', locationTags: [null, 7, { id: {} }] } },
    nullmeta: { metadata_json: null },
    evilname: { map_yaml: '../../etc/passwd.yaml', map_pgm: '../../etc/passwd.pgm' },
    htmlname: { map_yaml: '<img src=x onerror=alert(1)>.yaml' },
    missing: { map_pgm_content: undefined, map_yaml_content: undefined },
  };
  if (corrupt[faults.mapFault]) {
    ws.send(
      JSON.stringify({
        event: 'MAP_DATA_RESPONSE',
        payload: { files: { ...main, name: undefined, ...corrupt[faults.mapFault] } },
      })
    );
    return;
  }
  ws.send(
    JSON.stringify({
      event: 'MAP_DATA_RESPONSE',
      payload: {
        files: {
          map_yaml: main.map_yaml,
          map_pgm: main.map_pgm,
          map_yaml_content: main.map_yaml_content,
          map_pgm_content: main.map_pgm_content,
          metadata_json: main.metadata_json,
          ...(others.length ? { additional_maps: others } : {}),
        },
      },
    })
  );
};

// The chunked protocol only exists on the backend side in this copy of dashboard_ros;
// the field names come from saveMapFromMapping.ts.
type Transfer = { set: MapSet; gz: Buffer; sha: string; id: string };
const transfers = new Map<Sock, Transfer[]>();
const sendNextManifest = (ws: Sock) => {
  const next = transfers.get(ws)?.[0];
  if (!next) {
    ws.send(JSON.stringify({ event: 'MAP_BATCH_COMPLETE', payload: {} }));
    return;
  }
  ws.send(
    JSON.stringify({
      event: 'MAP_MANIFEST',
      payload: {
        transferId: next.id,
        name: next.set.name,
        map_yaml: next.set.map_yaml,
        map_pgm: next.set.map_pgm,
        map_yaml_content: next.set.map_yaml_content,
        sha256: next.sha,
        contentHash: faults.mapHashes[next.set.name] ?? next.sha,
        total_chunks: Math.ceil(next.gz.length / CHUNK_BYTES),
        gzip_size: next.gz.length,
        is_default: next.set.name === 'map',
        metadata_json: next.set.metadata_json,
      },
    })
  );
};
const handleMappingChunked = (ws: Sock) => {
  transfers.set(
    ws,
    loadMapSets().map(set => {
      const raw = Buffer.from(set.map_pgm_content, 'base64');
      const gz =
        faults.mapFault === 'bomb'
          ? gzipSync(Buffer.alloc(300 * 1024 * 1024))
          : gzipSync(faults.mapFault === 'badgzip' ? Buffer.from('nope') : raw);
      const sha =
        faults.mapFault === 'sha' ? '0'.repeat(64) : createHash('sha256').update(raw).digest('hex');
      return { set, gz, sha, id: `${NAME}-${set.name}-${Date.now()}` };
    })
  );
  sendNextManifest(ws);
};
const handleMappingMessage = (ws: Sock, text: string) => {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    ws.send(JSON.stringify({ event: 'ERROR', payload: { message: 'Invalid JSON' } }));
    return;
  }
  received.mapping.push(data?.event);
  const queue = transfers.get(ws);
  switch (data?.event) {
    case 'GET_MAP_DATA':
      if (faults.mapFault === 'silent') return;
      if (faults.mapMode === 'chunked') handleMappingChunked(ws);
      else handleMappingLegacy(ws);
      return;
    case 'MAP_SEND_CHUNKS': {
      const current = queue?.[0];
      if (!current) return;
      const total = Math.ceil(current.gz.length / CHUNK_BYTES);
      for (let index = 0; index < total; index += 1) {
        const data = current.gz
          .subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES)
          .toString('base64');
        ws.send(
          JSON.stringify({ event: 'MAP_CHUNK', payload: { transferId: current.id, index, data } })
        );
      }
      ws.send(
        JSON.stringify({ event: 'MAP_TRANSFER_COMPLETE', payload: { transferId: current.id } })
      );
      return;
    }
    case 'MAP_SKIP':
    case 'MAP_TRANSFER_STORED':
    case 'MAP_TRANSFER_ERROR':
      queue?.shift();
      sendNextManifest(ws);
      return;
    default:
      ws.send(
        JSON.stringify({ event: 'ERROR', payload: { message: `Unknown event: ${data?.event}` } })
      );
  }
};

// ---- mission bridge: the same state that drives mission_plan.py ----
const blankMission = () => ({
  active: false,
  paused: false,
  missionId: null as number | null,
  startedAt: null as string | null,
  waypoints: [] as { x: number; y: number; theta: number }[],
  total: 0,
  lastAcked: -1,
  completionSent: false,
  goalActive: false,
  waitingPause: false,
  waitingCancel: false,
});
let mission = blankMission();
let runId = 0;
let mode: 'teleop' | 'autonomous' = 'autonomous';
let battery: number | null = 80.0;
let swEmergency = false;
let hwEmergency = false;
let pauseInFlight = false;
let pausedByEmergency = false;
let goalTimer: ReturnType<typeof setTimeout> | undefined;
const emergencyActive = () => swEmergency || hwEmergency;
const stopGoal = () => {
  clearTimeout(goalTimer);
  mission.goalActive = false;
};
const hardReset = () => {
  stopGoal();
  const nextRunStateId = runId;
  mission = blankMission();
  runId = nextRunStateId;
  pauseInFlight = false;
  pausedByEmergency = false;
};

const missionBroadcast = (event: string, payload: unknown) => broadcast(9487, { event, payload });
const controlAck = (
  requestType: string,
  status: string,
  missionId: number | null,
  message: string,
  requestId: string | null = null,
  run: number | null = null
) =>
  missionBroadcast('MISSION_CONTROL_ACK', {
    requestType,
    status,
    missionId,
    message,
    timestamp: iso(),
    requestId,
    runId: run === null ? null : String(run),
  });
const startAck = (
  status: string,
  missionId: number | null,
  message: string,
  requestId: string | null = null,
  run: number | null = null,
  startedAt: string | null = null
) =>
  missionBroadcast('MISSION_START_ACK', {
    status,
    missionId,
    message,
    timestamp: iso(),
    requestId,
    runId: run === null ? null : String(run),
    startedAt,
  });
const completed = (status: string, message: string) => {
  if (mission.completionSent) return;
  mission.completionSent = true;
  missionBroadcast('MISSION_COMPLETED', {
    missionId: mission.missionId,
    runId: String(runId),
    status,
    completionTime: iso(),
    ...(message ? { message } : {}),
  });
};
const statusUpdate = () => ({
  event: 'ROBOT_STATUS_UPDATE',
  payload: {
    robotId: 1,
    timestamp: iso(),
    mode,
    batteryPercentage: battery,
    chargingStatus: null,
    mission: {
      status: mission.active ? (mission.paused ? 'PAUSED' : 'ACTIVE') : 'IDLE',
      currentMissionId: mission.active ? mission.missionId : null,
      runId: mission.active ? String(runId) : null,
      startedAt: mission.active ? mission.startedAt : null,
      currentWaypointIndex: mission.active && mission.total > 0 ? mission.lastAcked + 1 : null,
      totalWaypoints: mission.active ? mission.total : null,
    },
  },
});
const metadataFor = (missionId: number) => {
  for (const set of loadMapSets()) {
    const found = (set.metadata_json.missions ?? []).find(
      (entry: any) => Number(entry.missionId) === missionId
    );
    if (found) return { set, found };
  }
  return null;
};
const advance = () => {
  stopGoal();
  mission.goalActive = true;
  goalTimer = setTimeout(() => {
    if (!mission.active || mission.paused) return;
    if (faults.failNext && mission.lastAcked >= 0) {
      faults.failNext = false;
      completed('failure', 'FollowWaypoints ended with status=6');
      hardReset();
      return;
    }
    const index = mission.lastAcked + 1;
    const last = index >= mission.total - 1;
    mission.lastAcked = index;
    missionBroadcast('WAYPOINT_ACK', {
      missionId: mission.missionId,
      runId: String(runId),
      waypointIndex: index + 1,
      totalWaypoints: mission.total,
      status: 'success',
      message: last ? 'Reached waypoint (result)' : 'Reached waypoint (feedback)',
      time: iso(),
    });
    if (last) {
      completed('success', 'All waypoints completed');
      hardReset();
      return;
    }
    advance();
  }, WAYPOINT_MS);
};
const markEmergencyPauseSatisfied = () => {
  if (!pauseInFlight) return;
  pauseInFlight = false;
  pausedByEmergency = true;
  if (!emergencyActive()) resumeAfterRelease();
};
const showUp = (missionId: number, requestId: string | null) => {
  const meta = metadataFor(missionId);
  if (!meta) {
    controlAck(
      'SHOW_UP',
      'failure',
      missionId,
      `No metadata*.json contains missionId=${missionId}`,
      requestId
    );
    return;
  }
  setTimeout(() => {
    controlAck(
      'SHOW_UP',
      'success',
      missionId,
      `Loaded map ${meta.set.map_yaml}`,
      requestId,
      mission.active ? runId : null
    );
  }, 100);
};
const startMission = (missionId: number, requestId: string | null) => {
  if (emergencyActive()) {
    startAck('failure', missionId, 'Mission start refused: emergency stop is active', requestId);
    return;
  }
  if (mission.active && !mission.paused) {
    startAck('failure', missionId, 'Mission already running', requestId);
    return;
  }
  const meta = metadataFor(missionId);
  if (!meta) {
    startAck('failure', missionId, `No metadata*.json contains missionId=${missionId}`, requestId);
    hardReset();
    return;
  }
  const tags = new Map(
    (meta.set.metadata_json.locationTags ?? []).map((tag: any) => [Number(tag.id), tag])
  );
  const waypoints = (meta.found.locationTagId ?? []).map((id: number) => tags.get(Number(id)));
  if (!waypoints.length || waypoints.some((tag: unknown) => !tag)) {
    startAck('failure', missionId, 'No waypoints resolved for mission', requestId);
    hardReset();
    return;
  }
  stopGoal();
  runId += 1;
  const thisRun = runId;
  mission = { ...blankMission(), active: true, missionId, waypoints, total: waypoints.length };
  setTimeout(() => {
    if (thisRun !== runId || !mission.active) return;
    mission.startedAt = iso();
    startAck(
      'success',
      missionId,
      `Loaded map ${meta.set.map_yaml}`,
      requestId,
      thisRun,
      mission.startedAt
    );
    advance();
  }, 100);
};
const pauseMission = (missionId: number | null, requestId: string | null) => {
  const auto = requestId === 'EMERGENCY_AUTO_PAUSE';
  if (!mission.active) {
    if (auto) pauseInFlight = false;
    controlAck('PAUSE_MISSION', 'failure', missionId, 'No mission running', requestId);
    return;
  }
  if (missionId !== null && mission.missionId !== null && missionId !== mission.missionId) {
    if (auto) pauseInFlight = false;
    controlAck('PAUSE_MISSION', 'failure', missionId, 'missionId mismatch', requestId, runId);
    return;
  }
  if (mission.paused) {
    if (auto) pauseInFlight = false;
    controlAck('PAUSE_MISSION', 'success', mission.missionId, 'Already paused', requestId, runId);
    return;
  }
  mission.paused = true;
  if (!mission.goalActive) {
    if (auto) markEmergencyPauseSatisfied();
    controlAck(
      'PAUSE_MISSION',
      'success',
      mission.missionId,
      'Paused (no active goal)',
      requestId,
      runId
    );
    return;
  }
  // As on the robot: once a goal is live the pause ack comes from the Nav2 result callback and
  // carries NO requestId.
  stopGoal();
  mission.waitingPause = true;
  const thisRun = runId;
  const confirmed = faults.noCancelConfirm ? CONFIRM_TIMEOUT_MS : NAV_CANCEL_MS;
  setTimeout(() => {
    if (thisRun !== runId || !mission.active || !mission.waitingPause) return;
    mission.waitingPause = false;
    markEmergencyPauseSatisfied();
    controlAck(
      'PAUSE_MISSION',
      'success',
      mission.missionId,
      faults.noCancelConfirm
        ? 'Paused (watchdog: no cancel confirm)'
        : 'Paused (Nav2 confirmed cancel)',
      null,
      runId
    );
  }, confirmed);
};
const resumeMission = (missionId: number | null, requestId: string | null) => {
  if (emergencyActive()) {
    controlAck(
      'RESUME_MISSION',
      'failure',
      missionId,
      'Resume refused: emergency stop is active',
      requestId,
      mission.active ? runId : null
    );
    return;
  }
  if (!mission.active) {
    controlAck('RESUME_MISSION', 'failure', missionId, 'No mission to resume', requestId);
    return;
  }
  if (missionId !== null && mission.missionId !== null && missionId !== mission.missionId) {
    controlAck('RESUME_MISSION', 'failure', missionId, 'missionId mismatch', requestId, runId);
    return;
  }
  if (!mission.paused) {
    controlAck('RESUME_MISSION', 'failure', missionId, 'Mission is not paused', requestId, runId);
    return;
  }
  const next = mission.lastAcked + 1;
  if (next >= mission.total) {
    completed('success', 'All waypoints already completed');
    hardReset();
    return;
  }
  mission.paused = false;
  mission.waitingPause = false;
  controlAck(
    'RESUME_MISSION',
    'success',
    mission.missionId,
    `Resuming with ${mission.total - next} remaining waypoints from ${next + 1}/${mission.total}`,
    requestId,
    runId
  );
  if (requestId === 'EMERGENCY_AUTO_RESUME') {
    pauseInFlight = false;
    pausedByEmergency = false;
  }
  advance();
};
const cancelMission = (missionId: number | null, requestId: string | null) => {
  if (!mission.active) {
    controlAck('CANCEL_MISSION', 'failure', missionId, 'No mission to cancel', requestId);
    return;
  }
  if (missionId !== null && mission.missionId !== null && missionId !== mission.missionId) {
    controlAck('CANCEL_MISSION', 'failure', missionId, 'missionId mismatch', requestId, runId);
    return;
  }
  const hadGoal = mission.goalActive;
  stopGoal();
  mission.waitingCancel = true;
  controlAck('CANCEL_MISSION', 'success', mission.missionId, 'Cancel requested', requestId, runId);
  const thisRun = runId;
  setTimeout(
    () => {
      if (thisRun !== runId || !mission.active || !mission.waitingCancel) return;
      completed(
        'cancelled',
        hadGoal && !faults.noCancelConfirm
          ? 'Cancelled (Nav2 confirmed cancel)'
          : 'Cancelled (watchdog: no cancel confirm)'
      );
      hardReset();
    },
    hadGoal && !faults.noCancelConfirm ? NAV_CANCEL_MS : CONFIRM_TIMEOUT_MS
  );
};
const normalizeMode = (target: unknown) => {
  if (typeof target !== 'string') return null;
  const value = target.trim().toLowerCase();
  if (['teleopactive', 'teleop', 'teleoperation', 'teleop_mode'].includes(value)) return 'teleop';
  if (['autonomousactive', 'autonomous', 'auto', 'navigation', 'nav', 'nav_mode'].includes(value)) {
    return 'autonomous';
  }
  return null;
};
const modeAck = (status: string, currentMode: string, previousMode: string, error?: string) =>
  missionBroadcast('MODE_CHANGE_ACK', {
    status,
    currentMode,
    previousMode,
    timestamp: iso(),
    ...(error ? { error } : {}),
  });
const changeMode = (payload: any) => {
  const target = normalizeMode(payload?.targetMode);
  if (!target) {
    modeAck('failure', mode, mode, 'unknown_targetMode');
    return;
  }
  if (target === mode) {
    modeAck('success', mode, mode);
    return;
  }
  const previous = mode;
  // Going to teleop cancels Nav2 with no pause or cancel pending, so the result callback falls
  // through to "ended with status=5" and the mission fails.
  if (target === 'teleop' && mission.active && mission.goalActive) {
    stopGoal();
    const thisRun = runId;
    setTimeout(() => {
      if (thisRun !== runId || !mission.active) return;
      completed('failure', 'FollowWaypoints ended with status=5');
      hardReset();
    }, NAV_CANCEL_MS);
  }
  mode = target;
  modeAck('success', mode, previous);
};
const handleMissionMessage = (ws: Sock, text: string) => {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    ws.send(
      JSON.stringify({
        event: 'MISSION_CONTROL_ACK',
        payload: {
          requestType: 'UNKNOWN',
          status: 'failure',
          missionId: null,
          message: 'Invalid JSON',
        },
      })
    );
    return;
  }
  received.mission.push(data);
  const event = data?.event;
  const payload = data?.payload ?? {};
  if (event === 'CHANGE_MODE') {
    changeMode(payload);
    return;
  }
  const requestId = payload.requestId ?? null;
  const parsedId = Number(payload.missionId);
  const missionId =
    payload.missionId === null || payload.missionId === undefined || Number.isNaN(parsedId)
      ? null
      : Math.trunc(parsedId);
  switch (event) {
    case 'SHOW_UP':
      if (missionId === null) {
        controlAck('SHOW_UP', 'failure', null, 'missionId missing/invalid', requestId);
      } else showUp(missionId, requestId);
      return;
    case 'START_MISSION':
      if (missionId === null) startAck('failure', null, 'missionId missing/invalid', requestId);
      else startMission(missionId, requestId);
      return;
    case 'PAUSE_MISSION':
      pauseMission(missionId, requestId);
      return;
    case 'RESUME_MISSION':
      resumeMission(missionId, requestId);
      return;
    case 'CANCEL_MISSION':
      cancelMission(missionId, requestId);
      return;
    default:
      controlAck('UNKNOWN', 'failure', missionId, `Unknown event: ${event}`, requestId);
  }
};

// ---- emergency bridge ----
const emergencyState = () => ({
  softwareEmergencyActive: swEmergency,
  hardwareEmergencyActive: hwEmergency,
  effectiveEmergencyActive: emergencyActive(),
  timestamp: iso(),
});
function resumeAfterRelease() {
  if (emergencyActive() || pauseInFlight || !pausedByEmergency) return;
  if (!mission.active || !mission.paused) {
    pauseInFlight = false;
    pausedByEmergency = false;
    return;
  }
  if (mission.waitingPause || mission.waitingCancel) return;
  resumeMission(mission.missionId, 'EMERGENCY_AUTO_RESUME');
  if (!mission.paused) {
    pauseInFlight = false;
    pausedByEmergency = false;
  }
}
const onEmergencyChange = (wasActive: boolean) => {
  const isActive = emergencyActive();
  if (!wasActive && isActive) {
    if (!mission.active || mission.waitingCancel || mission.paused) return;
    if (mission.waitingPause || pauseInFlight) return;
    pauseInFlight = true;
    pauseMission(mission.missionId, 'EMERGENCY_AUTO_PAUSE');
  } else if (wasActive && !isActive) {
    resumeAfterRelease();
  }
};
const setHardware = (status: boolean) => {
  if (hwEmergency === status) return;
  const wasActive = emergencyActive();
  hwEmergency = status;
  broadcast(8766, {
    event: 'HARDWARE_EMERGENCY_ACK',
    payload: { status, ...emergencyState() },
  });
  broadcast(8766, { event: 'EMERGENCY_STATE', payload: emergencyState() });
  onEmergencyChange(wasActive);
};
const handleEmergencyMessage = (ws: Sock, text: string) => {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    return;
  }
  received.emergency.push(data);
  if (data?.event !== 'SOFTWARE_EMERGENCY') return;
  const status = Boolean(data?.payload?.status ?? false);
  const wasActive = emergencyActive();
  const changed = swEmergency !== status;
  swEmergency = status;
  ws.send(
    JSON.stringify({
      event: 'SOFTWARE_EMERGENCY_ACK',
      payload: { status, ...emergencyState() },
    })
  );
  if (changed) {
    broadcast(8766, { event: 'EMERGENCY_STATE', payload: emergencyState() });
    onEmergencyChange(wasActive);
  }
};

// ---- rosbridge ----
const pose = { x: 0, y: 0, yaw: 0 };
let twist = { linear: 0, angular: 0 };
let twistAt = 0;
const quaternion = (yaw: number) => ({
  x: 0,
  y: 0,
  z: Math.sin(yaw / 2),
  w: Math.cos(yaw / 2),
});
const zeroCovariance = new Array(36).fill(0);
const point = () => ({ x: pose.x, y: pose.y, z: 0 });
const publish = (topic: string, msg: unknown) => {
  const text = JSON.stringify({ op: 'publish', topic, msg });
  for (const ws of clients.get(9090) ?? []) {
    if (ws.data.subs.has(topic)) ws.send(text);
  }
};

// What the lidar can see: the occupied cells of the robot's main map.
const parseOccupancy = (set: MapSet | undefined) => {
  if (!set) return null;
  const resolution = Number(/resolution:\s*([\d.]+)/.exec(set.map_yaml_content)?.[1]);
  const origin = /origin:\s*\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/.exec(set.map_yaml_content);
  const pgm = Buffer.from(set.map_pgm_content, 'base64');
  const header = /^P5\s+(?:#.*\s+)*(\d+)\s+(\d+)\s+\d+\s/.exec(pgm.toString('latin1', 0, 256));
  if (!resolution || !origin || !header) return null;
  return {
    resolution,
    originX: Number(origin[1]),
    originY: Number(origin[2]),
    width: Number(header[1]),
    height: Number(header[2]),
    cells: pgm.subarray(header[0].length),
  };
};
const occupancy = parseOccupancy(mainMapSet(loadMapSets()));

const OCCUPIED_BELOW = 100; // Map cells are 0 occupied, 205 unknown, 254 free.
const SENSOR_FORWARD_M = 0.1; // Matches the base_scan transform on /tf_static_ui.
const NOISE_M = 0.02;

// One beam, walked in steps small enough not to slip through a wall one cell thick. A beam that hits
// nothing returns null: rosbridge encodes a real scan's inf that way.
const rangeAlong = (fromX: number, fromY: number, angle: number, min: number, max: number) => {
  if (!occupancy) return null;
  const { cells, width, height, resolution, originX, originY } = occupancy;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  for (let range = min; range <= max; range += resolution / 3) {
    const column = Math.floor((fromX + range * dx - originX) / resolution);
    const row = height - 1 - Math.floor((fromY + range * dy - originY) / resolution);
    if (column < 0 || row < 0 || column >= width || row >= height) return null;
    if ((cells[row * width + column] ?? 255) < OCCUPIED_BELOW) {
      return range + (Math.random() - 0.5) * NOISE_M;
    }
  }
  return null;
};

const laserMessage = (header: unknown) => {
  const count = 360;
  const base = {
    header,
    angle_min: -Math.PI,
    angle_max: Math.PI,
    angle_increment: (2 * Math.PI) / count,
    time_increment: 0,
    scan_time: 0.2,
    range_min: 0.12,
    range_max: 12,
    intensities: [],
  };
  switch (faults.laser) {
    case 'nulls':
      return { ...base, ranges: new Array(count).fill(null) };
    case 'empty':
      return { ...base, ranges: [] };
    case 'huge':
      return { ...base, ranges: new Array(200_000).fill(3.5) };
    case 'zeroinc':
      return { ...base, angle_increment: 0, ranges: new Array(count).fill(1) };
    case 'missing':
      return { header };
    case 'strings':
      return { ...base, ranges: new Array(count).fill('x') };
    default: {
      const sensorX = pose.x + SENSOR_FORWARD_M * Math.cos(pose.yaw);
      const sensorY = pose.y + SENSOR_FORWARD_M * Math.sin(pose.yaw);
      return {
        ...base,
        ranges: Array.from({ length: count }, (_, i) =>
          rangeAlong(
            sensorX,
            sensorY,
            pose.yaw + base.angle_min + i * base.angle_increment,
            base.range_min,
            base.range_max
          )
        ),
      };
    }
  }
};
const planPoses = (header: unknown) =>
  mission.active
    ? mission.waypoints.slice(mission.lastAcked + 1).map(tag => ({
        header,
        pose: {
          position: { x: tag.x, y: tag.y, z: 0 },
          orientation: quaternion(tag.theta ?? 0),
        },
      }))
    : [];
setInterval(() => {
  const dt = 0.05;
  const target =
    mission.active && !mission.paused ? mission.waypoints[mission.lastAcked + 1] : null;
  if (!emergencyActive()) {
    if (target) {
      const leg = WAYPOINT_MS / 1000;
      pose.x += ((target.x - pose.x) * dt) / leg;
      pose.y += ((target.y - pose.y) * dt) / leg;
    } else if (Date.now() - twistAt < 1000) {
      pose.yaw += twist.angular * dt;
      pose.x += twist.linear * Math.cos(pose.yaw) * dt;
      pose.y += twist.linear * Math.sin(pose.yaw) * dt;
    }
  }
}, 50);
setInterval(() => {
  const now = stamp();
  publish('/odom_ui', {
    header: { stamp: now, frame_id: 'odom' },
    child_frame_id: 'base_link',
    pose: {
      pose: { position: point(), orientation: quaternion(pose.yaw) },
      covariance: zeroCovariance,
    },
    twist: {
      twist: {
        linear: { x: twist.linear, y: 0, z: 0 },
        angular: { x: 0, y: 0, z: twist.angular },
      },
      covariance: zeroCovariance,
    },
  });
  publish('/tf_ui', {
    transforms: [
      {
        header: { stamp: now, frame_id: 'map' },
        child_frame_id: 'odom',
        transform: {
          translation: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
        },
      },
      {
        header: { stamp: now, frame_id: 'odom' },
        child_frame_id: 'base_link',
        transform: { translation: point(), rotation: quaternion(pose.yaw) },
      },
    ],
  });
}, 100);
setInterval(() => {
  const now = stamp();
  publish('/scan_ui', laserMessage({ stamp: now, frame_id: 'base_scan' }));
  publish('/scan_pose_ui', {
    header: { stamp: now, frame_id: 'map' },
    pose: { position: point(), orientation: quaternion(pose.yaw) },
  });
}, 200);
setInterval(() => {
  const now = stamp();
  const header = { stamp: now, frame_id: 'map' };
  publish('/amcl_pose_ui', {
    header,
    pose: {
      pose: { position: point(), orientation: quaternion(pose.yaw) },
      covariance: zeroCovariance,
    },
  });
  publish('/plan_ui', { header, poses: planPoses(header) });
}, 500);
const handleRosMessage = (ws: Sock, text: string) => {
  const data = JSON.parse(text);
  switch (data.op) {
    case 'subscribe':
      ws.data.subs.set(data.topic, data.type);
      received.subscribed.push({ topic: data.topic, type: data.type });
      if (data.topic === '/tf_static_ui') {
        ws.send(
          JSON.stringify({
            op: 'publish',
            topic: '/tf_static_ui',
            msg: {
              transforms: [
                {
                  header: { stamp: stamp(), frame_id: 'base_link' },
                  child_frame_id: 'base_scan',
                  transform: {
                    translation: { x: 0.1, y: 0, z: 0.2 },
                    rotation: { x: 0, y: 0, z: 0, w: 1 },
                  },
                },
              ],
            },
          })
        );
      }
      return;
    case 'unsubscribe':
      ws.data.subs.delete(data.topic);
      return;
    case 'advertise':
      received.advertised.push({ topic: data.topic, type: data.type, latch: data.latch });
      return;
    case 'publish':
      if (data.topic === '/cmd_vel_ui') {
        received.cmdVel.push({ t: Date.now(), msg: data.msg });
        twist = { linear: data.msg?.linear?.x ?? 0, angular: data.msg?.angular?.z ?? 0 };
        twistAt = Date.now();
      } else if (data.topic === '/initialpose_ui') {
        received.initialPose.push(data.msg);
        const position = data.msg?.pose?.pose?.position;
        if (position) {
          pose.x = position.x;
          pose.y = position.y;
        }
      }
      return;
  }
};

const GARBAGE: Record<number, unknown[]> = {
  9487: [
    'not json',
    '{}',
    '[]',
    'null',
    '123',
    '{"event":"ROBOT_STATUS_UPDATE"}',
    '{"event":"ROBOT_STATUS_UPDATE","payload":null}',
    '{"event":"ROBOT_STATUS_UPDATE","payload":{"mission":"nope","batteryPercentage":"lots"}}',
    '{"event":"WAYPOINT_ACK","payload":{"missionId":{},"runId":[],"waypointIndex":"x"}}',
    '{"event":"MISSION_COMPLETED","payload":{}}',
    '{"event":"MISSION_COMPLETED","payload":{"runId":{"$ne":null},"missionId":{"$gt":""}}}',
    '{"event":"MISSION_START_ACK","payload":{"status":"success","runId":{"$ne":""},"missionId":{"$ne":null},"startedAt":"not a date"}}',
    '{"event":"MODE_CHANGE_ACK","payload":{"currentMode":{"a":1}}}',
    `{"event":"MISSION_CONTROL_ACK","payload":{"message":"${'x'.repeat(2_000_000)}"}}`,
    new Uint8Array([0, 159, 146, 150]),
  ],
  8766: [
    'not json',
    'null',
    '{"event":"EMERGENCY_STATE"}',
    '{"event":"EMERGENCY_STATE","payload":null}',
    '{"event":"EMERGENCY_STATE","payload":{"softwareEmergencyActive":"yes","timestamp":{}}}',
    '{"event":"HARDWARE_EMERGENCY_ACK","payload":{"status":{}}}',
    new Uint8Array([255, 255]),
  ],
  9090: [
    'not json',
    '{"op":"publish","topic":"/odom_ui","msg":null}',
    '{"op":"publish","topic":"/odom_ui","msg":{"pose":{"pose":null}}}',
    '{"op":"publish","topic":"/scan_ui","msg":{"ranges":"x","header":null}}',
    '{"op":"publish","topic":"/scan_ui","msg":null}',
    '{"op":"publish","topic":"/scan_pose_ui","msg":{"pose":null,"header":{"stamp":"soon"}}}',
    '{"op":"publish","topic":"/tf_ui","msg":{"transforms":[null,{},{"header":null}]}}',
    '{"op":"publish","topic":"/tf_ui","msg":{"transforms":"x"}}',
    '{"op":"publish","topic":"/plan_ui","msg":{"poses":[null,{},{"pose":null}]}}',
    '{"op":"publish","topic":"/plan_ui","msg":{"poses":"x"}}',
    '{"op":"publish","topic":"/amcl_pose_ui","msg":{"pose":{"pose":{"position":"x"}}}}',
    '{"op":"status","level":"error","msg":"bridge says no"}',
    '{"op":"png","data":"AAAA"}',
    '{"op":"fragment","id":"x","data":"AAAA","num":0,"total":2}',
    new Uint8Array([1, 2, 3]),
  ],
  8765: ['not json', 'null', '{"event":"MAP_CHUNK","payload":{"transferId":"nope","index":-1}}'],
};

const serveBridge = (port: number, onMessage: (ws: Sock, text: string) => void) =>
  Bun.serve({
    port,
    idleTimeout: 0,
    fetch(req, server) {
      if (faults.refuse) return new Response('refused', { status: 503 });
      return server.upgrade(req, { data: { port, subs: new Map() } })
        ? undefined
        : new Response('websocket only', { status: 426 });
    },
    websocket: {
      maxPayloadLength: 256 * 1024 * 1024,
      open(ws: Sock) {
        clients.get(port)?.add(ws);
        everConnected.set(port, (everConnected.get(port) ?? 0) + 1);
        if (port === 9487) ws.send(JSON.stringify(statusUpdate()));
        if (port === 8766) {
          ws.send(JSON.stringify({ event: 'EMERGENCY_STATE', payload: emergencyState() }));
        }
      },
      close(ws: Sock) {
        clients.get(port)?.delete(ws);
        transfers.delete(ws);
      },
      message(ws: Sock, message) {
        onMessage(ws, String(message));
      },
    },
  });

serveBridge(9090, handleRosMessage);
serveBridge(8765, handleMappingMessage);
serveBridge(9487, handleMissionMessage);
serveBridge(8766, handleEmergencyMessage);
setInterval(() => broadcast(9487, statusUpdate()), STATUS_PERIOD_MS);

Bun.serve({
  port: 9000,
  fetch(req) {
    const url = new URL(req.url);
    const arg = (name: string) => url.searchParams.get(name);
    switch (url.pathname) {
      case '/stats':
        return Response.json({
          name: NAME,
          connections: Object.fromEntries([...clients].map(([port, set]) => [port, set.size])),
          everConnected: Object.fromEntries(everConnected),
          received: {
            cmdVel: received.cmdVel.slice(-500),
            initialPose: received.initialPose,
            advertised: received.advertised,
            subscribed: received.subscribed,
            mission: received.mission,
            emergency: received.emergency,
            mapping: received.mapping,
          },
          state: { mission, runId, mode, swEmergency, hwEmergency, pose, battery },
          faults,
        });
      case '/reset':
        for (const list of Object.values(received)) (list as unknown[]).length = 0;
        return new Response('ok');
      case '/hw':
        setHardware(arg('on') === '1');
        return new Response('ok');
      case '/drop': {
        const only = arg('port');
        for (const [port, set] of clients) {
          if (only && only !== String(port)) continue;
          for (const ws of set) ws.terminate();
        }
        return new Response('ok');
      }
      case '/refuse':
        faults.refuse = arg('on') === '1';
        return new Response('ok');
      case '/laser':
        faults.laser = arg('mode') ?? 'normal';
        return new Response('ok');
      case '/waypoint-ms':
        WAYPOINT_MS = Number(arg('v'));
        return new Response('ok');
      case '/fail-next':
        faults.failNext = true;
        return new Response('ok');
      case '/no-cancel-confirm':
        faults.noCancelConfirm = arg('on') === '1';
        return new Response('ok');
      case '/map':
        faults.mapMode = arg('mode') ?? faults.mapMode;
        faults.mapFault = arg('fault') ?? 'none';
        faults.mapHashes = JSON.parse(arg('hashes') ?? '{}');
        return new Response('ok');
      case '/battery':
        battery = arg('v') === 'null' ? null : Number(arg('v'));
        return new Response('ok');
      case '/status':
        broadcast(9487, statusUpdate());
        return new Response('ok');
      case '/garbage': {
        const port = Number(arg('port'));
        for (const frame of GARBAGE[port] ?? []) {
          for (const ws of clients.get(port) ?? []) ws.send(frame as string);
        }
        return new Response(String(GARBAGE[port]?.length ?? 0));
      }
      case '/flood': {
        const port = Number(arg('port'));
        const count = Number(arg('n'));
        const frame =
          port === 9487
            ? JSON.stringify(statusUpdate())
            : port === 8766
              ? JSON.stringify({ event: 'EMERGENCY_STATE', payload: emergencyState() })
              : JSON.stringify({
                  op: 'publish',
                  topic: '/scan_ui',
                  msg: laserMessage({ stamp: stamp(), frame_id: 'base_scan' }),
                });
        for (let i = 0; i < count; i += 1) {
          for (const ws of clients.get(port) ?? []) ws.send(frame);
        }
        return new Response('ok');
      }
      case '/rawbin': {
        const port = Number(arg('port'));
        const bytes = Uint8Array.from((arg('hex') ?? '').match(/../g) ?? [], h =>
          Number.parseInt(h, 16)
        );
        for (const ws of clients.get(port) ?? []) ws.send(bytes);
        return new Response('ok');
      }
      case '/raw': {
        const port = Number(arg('port'));
        return req.text().then(body => {
          broadcast(port, body);
          return new Response('ok');
        });
      }
      default:
        return new Response('not found', { status: 404 });
    }
  },
});
console.log(`mock robot ${NAME} ready`);
