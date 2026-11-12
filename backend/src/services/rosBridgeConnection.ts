import EventEmitter from 'node:events';
import ROSLIB from 'roslib';
import type WebSocket from 'ws';
import { parsePositiveMs } from '../utils/env.js';
import { startPingHeartbeat } from './bridgeSocket.js';

const toReadableError = (error: unknown, url: string) => {
  if (error instanceof Error) return error;

  if (error && typeof error === 'object') {
    const fields = error as { message?: unknown; reason?: unknown; code?: unknown; type?: unknown };
    const maybeMessage = fields.message ?? fields.reason ?? fields.code ?? fields.type;
    try {
      const json = JSON.stringify(error);
      return new Error(`ROS bridge ${url} error: ${maybeMessage ?? json}`);
    } catch {
      return new Error(`ROS bridge ${url} error: ${maybeMessage ?? String(error)}`);
    }
  }

  return new Error(`ROS bridge ${url} error: ${String(error)}`);
};

// roslib sets both at runtime and @types/roslib declares neither. Ros.js creates the socket with
// the ws package as soon as it is given a url.
type RosRuntime = ROSLIB.Ros & { isConnected: boolean; socket: WebSocket };

type TopicKey = `${string}:${string}`;

export type RosBridgeConnectionOptions = {
  id: string;
  url: string;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  connectTimeoutMs?: number;
};

type SubscribeOptions = {
  throttleRateMs?: number | undefined;
  queueLength?: number;
};

export class RosBridgeConnection extends EventEmitter {
  private ros: RosRuntime | null = null;
  private closed = false;
  private reconnectDelayMs: number;
  private maxReconnectDelayMs: number;
  private connectTimeoutMs: number;
  private publishers = new Map<TopicKey, ROSLIB.Topic>();
  private reconnectTimer: NodeJS.Timeout | undefined;
  private connecting = false;
  private heartbeatIntervalMs: number;
  private heartbeat?: NodeJS.Timeout;
  private confirmedThrough = 0;

  constructor(private readonly options: RosBridgeConnectionOptions) {
    super();
    this.reconnectDelayMs = options.reconnectDelayMs ?? 1000;
    this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? 10000;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 8000;
    this.heartbeatIntervalMs = parsePositiveMs('ROS_BRIDGE_HEARTBEAT_INTERVAL_MS', 3000);
  }

  async connect(): Promise<void> {
    if (this.closed || this.connecting || this.isConnected()) return;
    this.closeStaleRos();
    this.connecting = true;

    await new Promise<void>((resolve, reject) => {
      const ros = new ROSLIB.Ros({ url: this.options.url }) as RosRuntime;
      this.guardIncomingFrames(ros);
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        const err = new Error(
          `ROS bridge ${this.options.url} connect timeout after ${this.connectTimeoutMs}ms`
        );
        this.emit('error', err);
        this.connecting = false;
        settled = true;
        reject(err);
        this.scheduleReconnect();
        try {
          ros.close();
        } catch {}
      }, this.connectTimeoutMs);

      const settleConnected = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.ros = ros;
        this.connecting = false;
        this.reconnectDelayMs = this.options.reconnectDelayMs ?? 1000;
        this.clearReconnectTimer();
        this.startHeartbeat(ros);
        this.emit('connected');
        resolve();
      };

      const settleFailed = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.connecting = false;
        reject(err);
      };

      ros.on('connection', () => {
        settleConnected();
      });

      ros.on('error', (error: unknown) => {
        const err = toReadableError(error, this.options.url);
        this.emit('error', err);
        if (!settled) {
          settleFailed(err);
          this.scheduleReconnect();
        }
      });

      ros.on('close', () => {
        clearTimeout(timeout);
        const wasConnected = this.ros === ros;
        if (this.ros === ros) {
          this.ros = null;
          clearInterval(this.heartbeat);
        }
        this.publishers.clear();
        this.emit('disconnected');

        if (!settled) {
          const err = new Error(
            `ROS bridge ${this.options.url} closed before connection was established`
          );
          this.emit('error', err);
          settleFailed(err);
          this.scheduleReconnect();
          return;
        }

        if (wasConnected) {
          this.scheduleReconnect();
        }
      });
    });
  }

  disconnect() {
    this.closed = true;
    this.clearReconnectTimer();
    clearInterval(this.heartbeat);
    if (this.ros) {
      this.ros.close();
      this.ros = null;
    }
    this.publishers.clear();
  }

  subscribe(
    topicName: string,
    messageType: string,
    handler: (message: unknown) => void,
    options?: SubscribeOptions
  ): () => void {
    const topic = new ROSLIB.Topic({
      ros: this.readyRos(),
      name: topicName,
      messageType,
      // roslib reads both with `|| 0`; @types/roslib just won't accept undefined.
      throttle_rate: options?.throttleRateMs ?? 0,
      queue_length: options?.queueLength ?? 0,
    });

    topic.subscribe(handler);

    return () => {
      // @types/roslib leaves the message parameter off unsubscribe's callback.
      topic.unsubscribe(handler as () => void);
    };
  }

  // Returns true when this publish had to advertise first: rosbridge has only just created that
  // publisher, so subscribers may not have matched it yet and the message can be lost.
  publish(topicName: string, messageType: string, message: object): boolean {
    const ros = this.readyRos();
    const key: TopicKey = `${topicName}:${messageType}`;
    let topic = this.publishers.get(key);
    const advertised = !topic;

    if (!topic) {
      const shouldLatch = topicName === '/initialpose_ui';
      topic = new ROSLIB.Topic({
        ros,
        name: topicName,
        messageType,
        latch: shouldLatch,
      });
      topic.advertise();
      this.publishers.set(key, topic);
    }

    const rosMessage = new ROSLIB.Message(message);
    topic.publish(rosMessage);
    return advertised;
  }

  get url() {
    return this.options.url;
  }

  isConnected() {
    return this.ros?.isConnected === true;
  }

  // Frames arrive in order, so a pong to a ping sent after a publish proves the bridge received it.
  hasConfirmedSince(sentAt: number) {
    return this.confirmedThrough > sentAt;
  }

  getDebugStatus() {
    const socket = this.ros?.socket;
    return {
      id: this.options.id,
      url: this.options.url,
      connected: this.isConnected(),
      hasRos: Boolean(this.ros),
      connecting: this.connecting,
      socketReadyState: socket?.readyState ?? null,
      bufferedAmount: socket?.bufferedAmount ?? null,
    };
  }

  // A robot decides what it sends, and roslib parses frames inside the socket's event listener,
  // where an exception ends the process and every organization's robot connections with it.
  private guardIncomingFrames(ros: RosRuntime) {
    const socket = ros.socket;
    const handleFrame = socket.onmessage;
    if (typeof handleFrame !== 'function') return;
    socket.onmessage = frame => {
      try {
        handleFrame.call(socket, frame);
      } catch (error) {
        this.emit('error', toReadableError(error, this.options.url));
      }
    };
  }

  // Without it, commands sent into a half-open socket vanish with no error. rosbridge's Tornado
  // server answers pings on its own.
  private startHeartbeat(ros: RosRuntime) {
    const socket = ros.socket;
    clearInterval(this.heartbeat);
    this.heartbeat = startPingHeartbeat(
      socket,
      this.heartbeatIntervalMs,
      reason => this.dropDeadSocket(socket, reason),
      pingSentAt => {
        this.confirmedThrough = pingSentAt;
      }
    );
  }

  // terminate rather than close: there is nobody left to finish a close handshake with. The socket's
  // close event then clears the connection and schedules the reconnect.
  private dropDeadSocket(socket: { terminate: () => void }, reason: string) {
    clearInterval(this.heartbeat);
    this.emit('error', new Error(`ROS connection ${this.options.id} ${reason}; dropping socket`));
    socket.terminate();
  }

  private readyRos() {
    if (!this.ros || !this.isConnected()) {
      this.closeStaleRos();
      this.scheduleReconnect();
      throw new Error(`ROS connection ${this.options.id} not ready`);
    }
    return this.ros;
  }

  // Every teleop command lands here while disconnected, so an attempt already scheduled must stay
  // scheduled, or an operator holding the stick postpones the reconnect indefinitely.
  private scheduleReconnect() {
    if (this.closed || this.connecting || this.isConnected() || this.reconnectTimer) return;

    const delay = Math.min(this.reconnectDelayMs * 2, this.maxReconnectDelayMs);
    this.reconnectDelayMs = delay;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect().catch(() => {
        // swallow; errors are emitted via 'error'
      });
    }, delay);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private closeStaleRos() {
    if (!this.ros) return;
    const staleRos = this.ros;
    this.ros = null;
    clearInterval(this.heartbeat);
    this.publishers.clear();
    this.emit(
      'error',
      new Error(`ROS connection ${this.options.id} stale; closing before reconnect`)
    );
    try {
      staleRos.close();
    } catch {}
  }
}
