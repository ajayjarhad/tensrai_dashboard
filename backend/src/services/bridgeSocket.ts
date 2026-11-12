import type WebSocket from 'ws';

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 10_000;

// A half-open socket stays OPEN and accepts sends, so only a missing pong reveals it. An unanswered
// ping fails on the next tick: detection takes one to two intervals.
export const startPingHeartbeat = (
  socket: WebSocket,
  intervalMs: number,
  onDead: (reason: 'stopped answering pings' | 'ping failed') => void,
  onPong?: (pingSentAt: number) => void
) => {
  let pingSentAt: number | undefined;
  socket.on('pong', () => {
    if (pingSentAt !== undefined) onPong?.(pingSentAt);
    pingSentAt = undefined;
  });
  const heartbeat = setInterval(() => {
    if (pingSentAt !== undefined) {
      onDead('stopped answering pings');
      return;
    }
    pingSentAt = Date.now();
    try {
      socket.ping();
    } catch {
      onDead('ping failed');
    }
  }, intervalMs);
  heartbeat.unref?.();
  return heartbeat;
};

// Per robot: 1s, 2s, 4s and 8s, then every 10s until a connection opens.
export class ReconnectSchedule {
  private timers = new Map<string, NodeJS.Timeout>();
  private attempts = new Map<string, number>();

  attempt(robotId: string) {
    return this.attempts.get(robotId) ?? 0;
  }

  // Returns the delay, or undefined when a reconnect is already scheduled.
  schedule(robotId: string, reconnect: () => void) {
    if (this.timers.has(robotId)) return undefined;
    const attempt = this.attempt(robotId);
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
    this.attempts.set(robotId, attempt + 1);
    const timer = setTimeout(() => {
      this.timers.delete(robotId);
      reconnect();
    }, delay);
    this.timers.set(robotId, timer);
    return delay;
  }

  connected(robotId: string) {
    this.attempts.set(robotId, 0);
  }

  cancel(robotId: string) {
    clearTimeout(this.timers.get(robotId));
    this.timers.delete(robotId);
  }

  cancelAll() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
