import { getRedis, getSubscriber, isRedisAvailable } from "./redis";

export type SSEEventType =
  | "order.created"
  | "order.status_changed"
  | "agent.location_updated"
  | "stock.low"
  | "notification.new"
  | "plan.updated";

export type SSEEvent = {
  type: SSEEventType;
  tenantId: number;
  userId?: number;
  data: Record<string, unknown>;
  timestamp: number;
};

type SSEListener = {
  userId: number;
  tenantId: number;
  controller: ReadableStreamDefaultController;
  lastPing: number;
};

const REDIS_SSE_CHANNEL = "sse:events";

class SSEBus {
  private listeners = new Map<string, Set<SSEListener>>();
  private eventHistory = new Map<string, SSEEvent[]>();
  private maxHistoryPerChannel = 50;
  private historyTTL = 5 * 60 * 1000;
  private lastEviction = Date.now();
  private evictionInterval = 60 * 1000;
  private redisSubscribed = false;

  constructor() {
    this.setupRedisSubscription();
  }

  private setupRedisSubscription(): void {
    if (!isRedisAvailable() || this.redisSubscribed) return;

    try {
      const sub = getSubscriber();
      sub.subscribe(REDIS_SSE_CHANNEL, (err) => {
        if (err) {
          console.error("SSE Redis subscribe error:", err.message);
          return;
        }
        this.redisSubscribed = true;
      });

      sub.on("message", (channel, message) => {
        if (channel !== REDIS_SSE_CHANNEL) return;
        try {
          const event: SSEEvent = JSON.parse(message);
          this.dispatchToLocalListeners(event);
        } catch { /* ignore malformed messages */ }
      });
    } catch {
      // Redis unavailable, SSE works in single-instance mode
    }
  }

  private dispatchToLocalListeners(event: SSEEvent): void {
    const channel = `tenant:${event.tenantId}`;
    const listeners = this.listeners.get(channel);
    if (!listeners || listeners.size === 0) return;

    const payload = `data: ${JSON.stringify(event)}\n\n`;
    const dead: SSEListener[] = [];

    for (const listener of listeners) {
      try {
        if (event.userId && listener.userId !== event.userId) continue;
        listener.controller.enqueue(new TextEncoder().encode(payload));
        listener.lastPing = Date.now();
      } catch {
        dead.push(listener);
      }
    }

    for (const d of dead) listeners.delete(d);
  }

  private evictStaleEntries(): void {
    const now = Date.now();
    if (now - this.lastEviction < this.evictionInterval) return;
    this.lastEviction = now;
    const cutoff = now - this.historyTTL;
    for (const [channel, history] of this.eventHistory) {
      const firstValidIdx = history.findIndex(e => e.timestamp > cutoff);
      if (firstValidIdx === -1) {
        this.eventHistory.delete(channel);
      } else if (firstValidIdx > 0) {
        history.splice(0, firstValidIdx);
      }
    }
  }

  subscribe(
    tenantId: number,
    userId: number,
    controller: ReadableStreamDefaultController,
  ): () => void {
    const channel = `tenant:${tenantId}`;
    if (!this.listeners.has(channel)) {
      this.listeners.set(channel, new Set());
    }

    const listener: SSEListener = {
      userId,
      tenantId,
      controller,
      lastPing: Date.now(),
    };
    this.listeners.get(channel)!.add(listener);

    return () => {
      this.listeners.get(channel)?.delete(listener);
      if (this.listeners.get(channel)?.size === 0) {
        this.listeners.delete(channel);
      }
    };
  }

  emit(event: Omit<SSEEvent, "timestamp">): void {
    this.evictStaleEntries();

    const fullEvent: SSEEvent = { ...event, timestamp: Date.now() };
    const channel = `tenant:${event.tenantId}`;

    // Store in local history (always)
    if (!this.eventHistory.has(channel)) {
      this.eventHistory.set(channel, []);
    }
    const history = this.eventHistory.get(channel)!;
    history.push(fullEvent);
    if (history.length > this.maxHistoryPerChannel) {
      history.splice(0, history.length - this.maxHistoryPerChannel);
    }

    // Dispatch to local listeners
    this.dispatchToLocalListeners(fullEvent);

    // Publish to Redis so other instances receive it
    if (isRedisAvailable()) {
      try {
        getRedis().publish(REDIS_SSE_CHANNEL, JSON.stringify(fullEvent)).catch(() => {});
      } catch { /* Redis unavailable */ }
    }
  }

  getRecentEvents(tenantId: number, since?: number): SSEEvent[] {
    const channel = `tenant:${tenantId}`;
    const history = this.eventHistory.get(channel) ?? [];
    if (!since) return history;
    return history.filter(e => e.timestamp > since);
  }

  getStats(): { channels: number; totalListeners: number } {
    let total = 0;
    for (const listeners of this.listeners.values()) {
      total += listeners.size;
    }
    return { channels: this.listeners.size, totalListeners: total };
  }
}

export const sseBus = new SSEBus();
