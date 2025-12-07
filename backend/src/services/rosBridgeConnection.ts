// @ts-nocheck
import EventEmitter from 'node:events';
import ROSLIB from 'roslib';
import WebSocket from 'ws';

const toReadableError = (error: unknown, url: string) => {
  if (error instanceof Error) return error;

  if (error && typeof error === 'object') {
    const maybeMessage =
      (error as any).message ??
      (error as any).reason ??
      (error as any).code ??
      (error as any).type ??
      undefined;
    try {
      const json = JSON.stringify(error);
      return new Error(`ROS bridge ${url} error: ${maybeMessage ?? json}`);
    } catch {
      return new Error(`ROS bridge ${url} error: ${maybeMessage ?? String(error)}`);
    }
  }

  return new Error(`ROS bridge ${url} error: ${String(error)}`);
};

// roslib expects a global WebSocket implementation when used in Node.
if (!(globalThis as any).WebSocket) {
  (globalThis as any).WebSocket = WebSocket as unknown as typeof WebSocket;
}

export type RosBridgeConnectionEvents = {
  connected: () => void;
  disconnected: () => void;
  error: (error: Error) => void;
};

type TopicKey = `${string}:${string}`;

export type RosBridgeConnectionOptions = {
  id: string;
  url: string;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
};

export class RosBridgeConnection extends EventEmitter {
  private ros: ROSLIB.Ros | null = null;
  private closed = false;
  private reconnectDelayMs: number;
  private maxReconnectDelayMs: number;
  private publishers = new Map<TopicKey, ROSLIB.Topic>();
  private reconnectTimer?: NodeJS.Timeout;
  private connecting = false;

  constructor(private readonly options: RosBridgeConnectionOptions) {
    super();
    this.reconnectDelayMs = options.reconnectDelayMs ?? 1000;
    this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? 10000;
  }

  async connect(): Promise<void> {
    if (this.closed || this.connecting || this.ros) return;
    this.connecting = true;

    await new Promise<void>((resolve, reject) => {
      const ros = new ROSLIB.Ros({ url: this.options.url });
      let resolved = false;

      ros.on('connection', () => {
        this.ros = ros;
        this.connecting = false;
        this.reconnectDelayMs = this.options.reconnectDelayMs ?? 1000;
        this.clearReconnectTimer();
        this.emit('connected');
        resolved = true;
        resolve();
      });

      ros.on('error', (error: unknown) => {
        const err = toReadableError(error, this.options.url);
        this.emit('error', err);
        if (!resolved) {
          this.connecting = false;
          reject(err);
          this.scheduleReconnect();
        }
      });

      ros.on('close', () => {
        this.ros = null;
        this.publishers.clear();
        this.emit('disconnected');
        this.scheduleReconnect();
      });
    });
  }

  disconnect() {
    this.closed = true;
    this.clearReconnectTimer();
    if (this.ros) {
      this.ros.close();
      this.ros = null;
    }
    this.publishers.clear();
  }

  subscribe<T>(topicName: string, messageType: string, handler: (message: T) => void): () => void {
    if (!this.ros) {
      throw new Error(`ROS connection ${this.options.id} not ready`);
    }

    const topic = new ROSLIB.Topic({
      ros: this.ros,
      name: topicName,
      messageType,
    });

    topic.subscribe(handler);

    return () => {
      topic.unsubscribe(handler);
    };
  }

  publish<T>(topicName: string, messageType: string, message: T) {
    if (!this.ros) {
      throw new Error(`ROS connection ${this.options.id} not ready`);
    }

    const key: TopicKey = `${topicName}:${messageType}`;
    let topic = this.publishers.get(key);

    if (!topic) {
      const shouldLatch = topicName === '/initialpose';
      topic = new ROSLIB.Topic({
        ros: this.ros,
        name: topicName,
        messageType,
        latch: shouldLatch,
      });
      topic.advertise();
      this.publishers.set(key, topic);
    }

    const rosMessage = new ROSLIB.Message(message as Record<string, unknown>);
    topic.publish(rosMessage);
  }

  get url() {
    return this.options.url;
  }

  isConnected() {
    return this.ros !== null;
  }

  private scheduleReconnect() {
    if (this.closed || this.connecting || this.ros) return;

    const delay = Math.min(this.reconnectDelayMs * 2, this.maxReconnectDelayMs);
    this.reconnectDelayMs = delay;

    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
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
}
