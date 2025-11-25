// @ts-nocheck
import EventEmitter from 'events';
import type { RosChannelConfig, RosRobotConfig } from '../config/ros.js';
import { createLatestThrottle } from '../utils/throttle.js';
import { RosBridgeConnection } from './rosBridgeConnection.js';
import { combineTransforms, quaternionToYaw, type Pose2D } from '../utils/transform.js';

type ChannelRuntime = {
  config: RosChannelConfig;
  unsubscribe?: () => void;
  errorCount: number;
  lastMessageAt?: number;
};

const DEFAULT_LASER_OFFSET = { x: 0.12, y: 0, yaw: 0 };
const AMCL_MIN_DELTA_POS = 0.05;
const AMCL_MIN_DELTA_YAW = 0.05;
const SCAN_POSE_MAX_DRIFT_MS = 100;
// Allow older TF/odom stamps to avoid dropping to AMCL-only fallback when clocks lag.
const TF_STALE_MS = 1200;

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

export class RosRobotManager extends EventEmitter {
  private connections = new Map<string, RosBridgeConnection>();
  private channels = new Map<string, ChannelRuntime>();
  private started = false;
  private laserOffset = { ...DEFAULT_LASER_OFFSET };
  private mapPose?: Pose2D;
  private mapPoseStampMs?: number;
  private mapToOdom?: Pose2D & { stampMs?: number };
  private laserToBase?: Pose2D;
  private odomPose?: Pose2D & { stampMs?: number };
  private tfSubscribed = false;
  private baseFrames: string[] = ['base_link', 'base_footprint'];

  constructor(private readonly config: RosRobotConfig) {
    super();
    this.laserOffset = { ...DEFAULT_LASER_OFFSET, ...(config as any).laserOffset };
    this.initializeConnections();
    this.initializeChannels();
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
    for (const connectionId of this.connections.keys()) {
      this.handleConnectionConnected(connectionId);
    }
  }

  stop() {
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
    if (runtime.config.direction !== 'publish') return { ok: false, error: `Channel ${channelName} is not publishable` };
    const connection = this.getConnectionForChannel(runtime.config);
    if (!connection) return { ok: false, error: `No connection for channel ${channelName}` };
    try {
      connection.publish(runtime.config.topic, runtime.config.msgType, payload as object);
      return { ok: true };
    } catch (error) {
      runtime.errorCount += 1;
      this.emit('error', error as Error);
      return { ok: false, error: (error as Error).message };
    }
  }

  private initializeConnections() {
    const defaultConnectionId = 'default';
    const defaultConnection = new RosBridgeConnection({ id: defaultConnectionId, url: this.config.bridgeUrl });
    defaultConnection.on('error', error => this.emit('error', error));
    defaultConnection.on('connected', () => this.handleConnectionConnected(defaultConnectionId));
    defaultConnection.on('disconnected', () => this.handleConnectionDisconnected(defaultConnectionId));
    this.connections.set(defaultConnectionId, defaultConnection);
  }

  private initializeChannels() {
    for (const channel of this.config.channels) {
      this.channels.set(channel.name, { config: channel, errorCount: 0 });
    }
  }

  private getConnectionForChannel(config: RosChannelConfig) {
    return this.connections.get(config.connectionId ?? 'default');
  }

  private handleConnectionConnected(connectionId: string) {
    const connection = this.connections.get(connectionId);
    if (!connection || !connection.isConnected()) return;
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
        const unsubscribe = connection.subscribe(runtime.config.topic, runtime.config.msgType, d => throttled(d));
        runtime.unsubscribe = unsubscribe;
        runtime.errorCount = 0;
      } catch (error) {
        runtime.errorCount += 1;
        this.emit('error', error as Error);
      }
    }
  }

  private handleConnectionDisconnected(connectionId: string) {
    for (const runtime of this.channels.values()) {
      if ((runtime.config.connectionId ?? 'default') !== connectionId) continue;
      runtime.unsubscribe?.();
      runtime.unsubscribe = undefined;
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
    const stamp = raw?.header?.stamp;
    this.mapPoseStampMs =
      stamp && typeof stamp.sec === 'number' && typeof stamp.nanosec === 'number'
        ? stamp.sec * 1000 + stamp.nanosec / 1e6
        : Date.now();
    return raw;
  }

  private processLaser(raw: any) {
    if (!raw?.ranges || !Array.isArray(raw.ranges)) return raw;
    // use TF laser->base if present, else static offset
    const laserOffset = this.laserToBase ?? this.laserOffset;

    const scanStamp = raw?.header?.stamp;
    const scanStampMs =
      scanStamp && typeof scanStamp.sec === 'number' && typeof scanStamp.nanosec === 'number'
        ? scanStamp.sec * 1000 + scanStamp.nanosec / 1e6
        : null;
    if (scanStampMs === null) return raw;

    const tfStamp = (this.mapToOdom as any)?.stampMs;
    const odomStamp = this.odomPose?.stampMs;
    const tfStale = tfStamp !== undefined && Math.abs(scanStampMs - tfStamp) > TF_STALE_MS;
    const odomStale = odomStamp !== undefined && Math.abs(scanStampMs - odomStamp) > TF_STALE_MS;

    // Prefer TF-based pose when available and not stale; otherwise fall back to last AMCL map pose.
    let pose: Pose2D | undefined;
    let branch: 'tf+odom' | 'mapPose' | 'raw' = 'raw';
    if (this.mapToOdom && this.odomPose && !tfStale && !odomStale) {
      pose = combineTransforms(this.mapToOdom, this.odomPose);
      branch = 'tf+odom';
    } else if (this.mapPose) {
      pose = { ...this.mapPose };
      branch = 'mapPose';
    }

    if (!pose) return raw;

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

    return { ...raw, points, frame: 'map' };
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
      const parent = t?.header?.frame_id;
      const child = t?.child_frame_id;
      const trans = t?.transform?.translation;
      const rot = t?.transform?.rotation;
      if (!parent || !child || !trans || !rot) continue;
      const stamp = t?.header?.stamp;
      const stampMsRaw =
        stamp && typeof stamp.sec === 'number' && typeof stamp.nanosec === 'number'
          ? stamp.sec * 1000 + stamp.nanosec / 1e6
          : undefined;
      // Static transforms often carry stamp=0; treat them as timeless so they don't get flagged stale.
      const stampMs = stampMsRaw === 0 ? undefined : stampMsRaw;
      const yaw = quaternionToYaw({
        x: rot.x ?? 0,
        y: rot.y ?? 0,
        z: rot.z ?? 0,
        w: rot.w ?? 1,
      });
      if (parent === 'map' && child === 'odom') {
        this.mapToOdom = { x: trans.x ?? 0, y: trans.y ?? 0, yaw, stampMs };
      }
      if (
        (child === 'laser' || child === 'base_scan') &&
        (parent === 'base_footprint' || parent === 'base_link' || this.baseFrames.includes(parent))
      ) {
        this.laserToBase = { x: trans.x ?? 0, y: trans.y ?? 0, yaw };
      }
    }
  }
}
