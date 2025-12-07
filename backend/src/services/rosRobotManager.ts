// @ts-nocheck
import EventEmitter from 'node:events';
import type { RosChannelConfig, RosRobotConfig } from '../config/ros.js';
import { createLatestThrottle } from '../utils/throttle.js';
import { combineTransforms, type Pose2D, quaternionToYaw } from '../utils/transform.js';
import { RosBridgeConnection } from './rosBridgeConnection.js';

type ChannelRuntime = {
  config: RosChannelConfig;
  unsubscribe?: () => void;
  errorCount: number;
  lastMessageAt?: number;
};

const DEFAULT_LASER_OFFSET = { x: 0.12, y: 0, yaw: 0 };
const AMCL_MIN_DELTA_POS = 0.05;
const AMCL_MIN_DELTA_YAW = 0.05;
const _SCAN_POSE_MAX_DRIFT_MS = 100;
// Allow older TF/odom stamps to avoid dropping to AMCL-only fallback when clocks lag.
const TF_STALE_MS = 1200;
// Teleop safety defaults
const TELEOP_MAX_LINEAR = 0.5; // m/s
const TELEOP_MAX_ANGULAR = 0.8; // rad/s
const TELEOP_WATCHDOG_MS = 750; // send zero if idle
const POSE_EPS = 1e-3;

const pickPose = (pose: any) => {
  if (!pose) return undefined;
  return {
    position: {
      x: pose.position?.x ?? 0,
      y: pose.position?.y ?? 0,
      z: pose.position?.z ?? 0,
    },
    orientation: {
      x: pose.orientation?.x ?? 0,
      y: pose.orientation?.y ?? 0,
      z: pose.orientation?.z ?? 0,
      w: pose.orientation?.w ?? 1,
    },
  };
};

const sanitizeChannelPayload = (channelName: string, data: unknown) => {
  if (!data || typeof data !== 'object') return data;
  if (channelName === 'odom') {
    const odom = data as any;
    return { pose: odom.pose ? { pose: pickPose(odom.pose.pose) } : undefined };
  }
  if (channelName === 'amcl') {
    const amcl = data as any;
    return { pose: amcl.pose ? { pose: pickPose(amcl.pose.pose) } : undefined };
  }
  if (channelName === 'laser') {
    const scan = data as any;
    return {
      angle_min: scan.angle_min,
      angle_max: scan.angle_max,
      angle_increment: scan.angle_increment,
      range_min: scan.range_min,
      range_max: scan.range_max,
      ranges: scan.ranges,
      points: scan.points,
      frame: scan.frame,
    };
  }
  if (channelName === 'waypoints') {
    const path = data as any;
    const poses = Array.isArray(path.poses)
      ? path.poses.map((p: any) => ({ pose: pickPose(p.pose) }))
      : [];
    return { poses };
  }
  return data;
};

const zeroTwist = () => ({
  linear: { x: 0, y: 0, z: 0 },
  angular: { x: 0, y: 0, z: 0 },
});

const clampNumber = (value: unknown, limit: number) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  if (!Number.isFinite(limit) || limit <= 0) return value;
  return Math.max(-limit, Math.min(limit, value));
};

const validateAndClampTeleop = (
  payload: unknown,
  limits?: { maxLinear?: number; maxAngular?: number }
): { ok: boolean; value?: any; error?: string } => {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'teleop payload must be an object' };
  }
  const linear = (payload as any).linear ?? {};
  const angular = (payload as any).angular ?? {};
  if (typeof linear !== 'object' || typeof angular !== 'object') {
    return { ok: false, error: 'teleop payload missing linear/angular' };
  }
  const maxLinear = limits?.maxLinear ?? TELEOP_MAX_LINEAR;
  const maxAngular = limits?.maxAngular ?? TELEOP_MAX_ANGULAR;
  const clamped = {
    linear: {
      x: clampNumber(linear.x, maxLinear),
      y: 0,
      z: 0,
    },
    angular: {
      x: 0,
      y: 0,
      z: clampNumber(angular.z, maxAngular),
    },
  };
  return { ok: true, value: clamped };
};

export class RosRobotManager extends EventEmitter {
  private connections = new Map<string, RosBridgeConnection>();
  private channels = new Map<string, ChannelRuntime>();
  private started = false;
  private laserOffset = { ...DEFAULT_LASER_OFFSET };
  private mapPose?: Pose2D;
  // private mapPoseStampMs?: number;
  private mapToOdom?: Pose2D & { stampMs?: number };
  private mapToBase?: Pose2D & { stampMs?: number };
  private odomToBase?: Pose2D & { stampMs?: number };
  private lastPublishedPose?: Pose2D & { stampMs?: number; source?: string };
  private laserToBase?: Pose2D;
  private odomPose?: Pose2D & { stampMs?: number };
  private tfSubscribed = false;
  private baseFrames: string[] = ['base_link', 'base_footprint'];
  private teleopTimers = new Map<string, NodeJS.Timeout>();
  private teleopLimits: { maxLinear: number; maxAngular: number; watchdogMs: number };

  constructor(readonly config: RosRobotConfig) {
    super();
    this.laserOffset = { ...DEFAULT_LASER_OFFSET, ...(config as any).laserOffset };
    const userTeleop =
      typeof (config as any).teleopLimits === 'object' ? (config as any).teleopLimits : {};
    this.teleopLimits = {
      maxLinear: TELEOP_MAX_LINEAR,
      maxAngular: TELEOP_MAX_ANGULAR,
      watchdogMs: TELEOP_WATCHDOG_MS,
      ...userTeleop,
    };
    this.initializeConnections();
    this.initializeChannels();
  }

  private initializeConnections() {
    const rawConnections = Array.isArray((this.config as any).connections)
      ? ((this.config as any).connections as Array<{ id?: string; url?: string }>)
      : [];

    const fallbackUrl = (this.config as any).bridgeUrl;
    const connectionDefs = rawConnections.length
      ? rawConnections
      : fallbackUrl
        ? [{ id: 'default', url: fallbackUrl }]
        : [];

    for (const def of connectionDefs) {
      const id = def.id ?? 'default';
      const url = def.url ?? fallbackUrl;
      if (!url) {
        this.emit('error', new Error(`ROS connection ${id} missing URL`));
        continue;
      }
      if (this.connections.has(id)) continue;

      const connection = new RosBridgeConnection({ id, url });
      connection.on('connected', () => this.handleConnectionConnected(id));
      connection.on('error', error => this.emit('error', error));

      this.connections.set(id, connection);
    }
  }

  private initializeChannels() {
    const configChannels = Array.isArray((this.config as any).channels)
      ? ((this.config as any).channels as RosChannelConfig[])
      : [];

    for (const channel of configChannels) {
      if (!channel?.name) continue;
      const connectionId = channel.connectionId ?? 'default';
      if (!this.connections.has(connectionId)) {
        this.emit(
          'error',
          new Error(`Channel ${channel.name} references missing connection ${connectionId}`)
        );
      }
      this.channels.set(channel.name, { config: channel, errorCount: 0 });
    }
  }

  async start() {
    if (this.started) return;
    this.started = true;
    await Promise.all(
      Array.from(this.connections.values()).map(async connection => {
        try {
          await connection.connect();
        } catch (error) {
          this.emit('error', error);
        }
      })
    );
  }

  stop() {
    this.sendZeroTeleopIfNeeded();
    for (const runtime of this.channels.values()) {
      runtime.unsubscribe?.();
    }
    for (const connection of this.connections.values()) {
      connection.disconnect();
    }
    this.started = false;
  }

  handleCommand(channelName: string, payload: unknown): { ok: boolean; error?: string } {
    const runtime = this.channels.get(channelName);
    if (!runtime) return { ok: false, error: `Unknown channel: ${channelName}` };
    if (runtime.config.direction !== 'publish')
      return { ok: false, error: `Channel ${channelName} is not publishable` };

    let outgoing = payload;
    if (channelName === 'teleop') {
      const result = validateAndClampTeleop(payload, this.teleopLimits);
      if (!result.ok) return { ok: false, error: result.error };
      outgoing = result.value;
      this.armTeleopWatchdog(runtime.config);
    }

    const connection = this.getConnectionForChannel(runtime.config);
    if (!connection) return { ok: false, error: `No connection for channel ${channelName}` };
    try {
      connection.publish(runtime.config.topic, runtime.config.msgType, outgoing as object);
      return { ok: true };
    } catch (error) {
      runtime.errorCount += 1;
      this.emit('error', error as Error);
      return { ok: false, error: (error as Error).message };
    }
  }

  private handleConnectionConnected(connectionId: string) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    if (!this.tfSubscribed && connectionId === 'default') {
      this.subscribeTf(connection);
      this.tfSubscribed = true;
    }
    for (const [name, runtime] of this.channels.entries()) {
      if ((runtime.config.connectionId ?? 'default') !== connectionId) continue;
      if (runtime.config.direction !== 'subscribe') continue;
      runtime.unsubscribe?.();
      const throttled = createLatestThrottle(runtime.config.rateLimitHz, (data: unknown) => {
        runtime.lastMessageAt = Date.now();
        let processed = data;
        if (name === 'laser') processed = this.processLaser(data as any);
        else if (name === 'odom') processed = this.processOdom(data as any);
        else if (name === 'amcl') processed = this.processAmcl(data as any);
        const sanitized = sanitizeChannelPayload(name, processed);
        this.emit('channel-data', { channel: name, data: sanitized });
      });
      try {
        const unsubscribe = connection.subscribe(runtime.config.topic, runtime.config.msgType, d =>
          throttled(d)
        );
        runtime.unsubscribe = unsubscribe;
        runtime.errorCount = 0;
      } catch (error) {
        runtime.errorCount += 1;
        this.emit('error', error as Error);
      }
    }
  }

  private getConnectionForChannel(config: RosChannelConfig) {
    const connectionId = config.connectionId ?? 'default';
    return this.connections.get(connectionId);
  }

  private armTeleopWatchdog(config: RosChannelConfig) {
    const timeoutMs = this.teleopLimits.watchdogMs;
    if (!timeoutMs || timeoutMs <= 0) return;
    const channelName = config.name ?? 'teleop';
    const existing = this.teleopTimers.get(channelName);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.teleopTimers.delete(channelName);
      try {
        const connection = this.getConnectionForChannel(config);
        if (connection) {
          connection.publish(config.topic, config.msgType, zeroTwist());
        }
      } catch {
        // ignore watchdog send failures
      }
    }, timeoutMs);
    this.teleopTimers.set(channelName, timer);
  }

  private sendZeroTeleopIfNeeded() {
    for (const timer of this.teleopTimers.values()) {
      clearTimeout(timer);
    }
    this.teleopTimers.clear();
    const teleop = this.channels.get('teleop');
    if (!teleop || teleop.config.direction !== 'publish') return;
    try {
      const connection = this.getConnectionForChannel(teleop.config);
      connection?.publish(teleop.config.topic, teleop.config.msgType, zeroTwist());
    } catch {
      // ignore cleanup send failures
    }
  }

  private processOdom(raw: any) {
    if (!raw?.pose?.pose) return raw;
    const pos = raw.pose.pose.position ?? {};
    const ori = raw.pose.pose.orientation ?? {};
    const yaw = quaternionToYaw({
      x: ori.x ?? 0,
      y: ori.y ?? 0,
      z: ori.z ?? 0,
      w: ori.w ?? 1,
    });
    const stamp = raw?.header?.stamp;
    const stampMs =
      stamp && typeof stamp.sec === 'number' && typeof stamp.nanosec === 'number'
        ? stamp.sec * 1000 + stamp.nanosec / 1e6
        : undefined;
    this.odomPose = { x: pos.x ?? 0, y: pos.y ?? 0, yaw, stampMs };
    this.maybeEmitBasePose();
    return raw;
  }

  private processAmcl(raw: any) {
    if (!raw?.pose?.pose) return raw;
    const pos = raw.pose.pose.position ?? {};
    const ori = raw.pose.pose.orientation ?? {};
    const yaw = quaternionToYaw({
      x: ori.x ?? 0,
      y: ori.y ?? 0,
      z: ori.z ?? 0,
      w: ori.w ?? 1,
    });
    const nextPose = { x: pos.x ?? 0, y: pos.y ?? 0, yaw };
    if (this.mapPose) {
      const dx = nextPose.x - this.mapPose.x;
      const dy = nextPose.y - this.mapPose.y;
      const dPos = Math.hypot(dx, dy);
      const dYaw = Math.abs(nextPose.yaw - this.mapPose.yaw);
      if (dPos < AMCL_MIN_DELTA_POS && dYaw < AMCL_MIN_DELTA_YAW) return raw;
    }
    this.mapPose = nextPose;
    return raw;
  }

  private processLaser(raw: any) {
    if (!raw?.ranges || !Array.isArray(raw.ranges)) return raw;

    const scanStamp = raw?.header?.stamp;
    const scanStampMs =
      scanStamp && typeof scanStamp.sec === 'number' && typeof scanStamp.nanosec === 'number'
        ? scanStamp.sec * 1000 + scanStamp.nanosec / 1e6
        : null;
    if (scanStampMs === null) return raw;

    const pose = this.getLaserPose(scanStampMs);
    if (!pose) return raw;

    const laserOffset = this.laserToBase ?? this.laserOffset;
    const points = this.computeLaserPoints(raw, pose, laserOffset);

    return { ...raw, points, frame: 'map' };
  }

  private getLaserPose(scanStampMs: number): Pose2D | undefined {
    const tfStamp = (this.mapToOdom as any)?.stampMs;
    const odomStamp = this.odomPose?.stampMs;
    const tfStale = tfStamp !== undefined && Math.abs(scanStampMs - tfStamp) > TF_STALE_MS;
    const odomStale = odomStamp !== undefined && Math.abs(scanStampMs - odomStamp) > TF_STALE_MS;

    if (this.mapToOdom && this.odomPose && !tfStale && !odomStale) {
      return combineTransforms(this.mapToOdom, this.odomPose);
    }
    if (this.mapPose) {
      return { ...this.mapPose };
    }
    return undefined;
  }

  private computeLaserPoints(
    raw: any,
    pose: Pose2D,
    laserOffset: Pose2D
  ): Array<{ x: number; y: number }> {
    const { angle_min, angle_increment, ranges, range_min, range_max } = raw;
    const cosOff = Math.cos(laserOffset.yaw);
    const sinOff = Math.sin(laserOffset.yaw);
    const cosPose = Math.cos(pose.yaw);
    const sinPose = Math.sin(pose.yaw);

    const points: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      if (!Number.isFinite(r) || r < range_min || r > range_max) continue;
      const angle = angle_min + i * angle_increment;
      const sx = r * Math.cos(angle);
      const sy = r * Math.sin(angle);
      const bx = laserOffset.x + cosOff * sx - sinOff * sy;
      const by = laserOffset.y + sinOff * sx + cosOff * sy;
      const wx = pose.x + cosPose * bx - sinPose * by;
      const wy = pose.y + sinPose * bx + cosPose * by;
      points.push({ x: wx, y: wy });
    }
    return points;
  }

  private subscribeTf(connection: RosBridgeConnection) {
    const handle = (msg: any) => this.handleTfMessage(msg);
    try {
      connection.subscribe('/tf', 'tf2_msgs/msg/TFMessage', handle);
      connection.subscribe('/tf_static', 'tf2_msgs/msg/TFMessage', handle);
    } catch (err) {
      this.emit('error', err as Error);
    }
  }

  private handleTfMessage(msg: any) {
    const transforms = msg?.transforms;
    if (!Array.isArray(transforms)) return;
    for (const t of transforms) {
      this.processTransform(t);
    }
  }

  private processTransform(t: any) {
    const transformData = this.extractTransformData(t);
    if (!transformData) return;

    this.updateTransformValues(transformData);
  }

  private extractTransformData(t: any) {
    const parent = t?.header?.frame_id;
    const child = t?.child_frame_id;
    const trans = t?.transform?.translation;
    const rot = t?.transform?.rotation;

    if (!parent || !child || !trans || !rot) return null;

    return {
      parent,
      child,
      trans,
      rot,
      stamp: t?.header?.stamp,
    };
  }

  private updateTransformValues(transformData: {
    parent: string;
    child: string;
    trans: any;
    rot: any;
    stamp: any;
  }) {
    const { parent, child, trans, rot, stamp } = transformData;

    const stampMs = this.getStampMs(stamp);
    const yaw = quaternionToYaw({
      x: rot.x ?? 0,
      y: rot.y ?? 0,
      z: rot.z ?? 0,
      w: rot.w ?? 1,
    });

    this.updateTransformBasedOnFrame(parent, child, trans, yaw, stampMs);
    this.maybeEmitBasePose();
  }

  private getStampMs(stamp: any): number | undefined {
    const stampMsRaw =
      stamp && typeof stamp.sec === 'number' && typeof stamp.nanosec === 'number'
        ? stamp.sec * 1000 + stamp.nanosec / 1e6
        : undefined;
    // Static transforms often carry stamp=0; treat them as timeless so they don't get flagged stale.
    return stampMsRaw === 0 ? undefined : stampMsRaw;
  }

  private updateTransformBasedOnFrame(
    parent: string,
    child: string,
    trans: any,
    yaw: number,
    stampMs?: number
  ) {
    if (parent === 'map' && child === 'odom') {
      this.mapToOdom = { x: trans.x ?? 0, y: trans.y ?? 0, yaw, stampMs };
    }
    if (parent === 'map' && this.baseFrames.includes(child)) {
      this.mapToBase = { x: trans.x ?? 0, y: trans.y ?? 0, yaw, stampMs };
    }
    if (parent === 'odom' && this.baseFrames.includes(child)) {
      this.odomToBase = { x: trans.x ?? 0, y: trans.y ?? 0, yaw, stampMs };
    }
    if (
      (child === 'laser' || child === 'base_scan') &&
      (parent === 'base_footprint' || parent === 'base_link' || this.baseFrames.includes(parent))
    ) {
      this.laserToBase = { x: trans.x ?? 0, y: trans.y ?? 0, yaw };
    }
  }

  private isTfStale(tf?: { stampMs?: number }, referenceMs?: number) {
    if (!tf) return true;
    if (tf.stampMs === undefined) return false; // static TF
    if (referenceMs === undefined) return false; // no reference clock; trust TF
    return Math.abs(referenceMs - tf.stampMs) > TF_STALE_MS;
  }

  private computeMapBasePose(): { pose: Pose2D; source: string; stampMs?: number } | undefined {
    const refMs = this.odomPose?.stampMs;
    // 1) direct map->base TF
    if (this.mapToBase && !this.isTfStale(this.mapToBase, refMs)) {
      return {
        pose: { ...this.mapToBase },
        source: 'tf:map->base',
        stampMs: this.mapToBase.stampMs,
      };
    }
    // 2) map->odom TF + odom->base TF
    if (
      this.mapToOdom &&
      this.odomToBase &&
      !this.isTfStale(this.mapToOdom, refMs) &&
      !this.isTfStale(this.odomToBase, refMs)
    ) {
      const pose = combineTransforms(this.mapToOdom, this.odomToBase);
      return { pose, source: 'tf:map->odom + odom->base', stampMs: this.mapToOdom.stampMs };
    }
    // 3) map->odom TF + odom pose topic (fallback)
    if (this.mapToOdom && this.odomPose && !this.isTfStale(this.mapToOdom, this.odomPose.stampMs)) {
      const pose = combineTransforms(this.mapToOdom, this.odomPose);
      return { pose, source: 'tf:map->odom + odom topic', stampMs: this.mapToOdom.stampMs };
    }
    // 4) amcl pose as last resort
    if (this.mapPose) {
      return { pose: { ...this.mapPose }, source: 'amcl' };
    }
    return undefined;
  }

  private yawToQuaternion(yaw: number) {
    const half = yaw / 2;
    return { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) };
  }

  private maybeEmitBasePose() {
    const resolved = this.computeMapBasePose();
    if (!resolved) return;
    const { pose, source, stampMs } = resolved;
    const last = this.lastPublishedPose;
    const yawDelta = Math.abs((pose.yaw ?? 0) - (last?.yaw ?? 0));
    const posDelta = Math.hypot((pose.x ?? 0) - (last?.x ?? 0), (pose.y ?? 0) - (last?.y ?? 0));
    if (last && posDelta < POSE_EPS && yawDelta < POSE_EPS) return;

    const orientation = this.yawToQuaternion(pose.yaw ?? 0);
    this.lastPublishedPose = { ...pose, stampMs, source };
    this.emit('channel-data', {
      channel: 'pose',
      data: {
        x: pose.x,
        y: pose.y,
        yaw: pose.yaw,
        theta: pose.yaw,
        stampMs,
        source,
        pose: {
          pose: {
            position: { x: pose.x, y: pose.y, z: 0 },
            orientation,
          },
        },
      },
    });
  }
}
