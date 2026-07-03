/**
 * Server-Sent Events (SSE) infrastructure.
 * Provides an event bus for broadcasting real-time updates to connected clients.
 *
 * Architecture:
 * - In-memory event emitter for single-instance deployments
 * - Channel-based: each tenant gets its own channel
 * - Graceful degradation: if SSE fails, tRPC mutation still succeeds
 */

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

class SSEBus {
  private listeners = new Map<string, Set<SSEListener>>();
  private eventHistory = new Map<string, SSEEvent[]>();
  private maxHistoryPerChannel = 50;
  private historyTTL = 5 * 60 * 1000; // 5 minutes
  private lastEviction = Date.now();
  private evictionInterval = 60 * 1000; // run eviction every 60s

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

  /** Subscribe a client to SSE events for a tenant */
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

    // Return unsubscribe function
    return () => {
      this.listeners.get(channel)?.delete(listener);
      if (this.listeners.get(channel)?.size === 0) {
        this.listeners.delete(channel);
      }
    };
  }

  /** Emit an event to all subscribers of a tenant */
  emit(event: Omit<SSEEvent, "timestamp">): void {
    this.evictStaleEntries();

    const fullEvent: SSEEvent = { ...event, timestamp: Date.now() };
    const channel = `tenant:${event.tenantId}`;

    // Store in history
    if (!this.eventHistory.has(channel)) {
      this.eventHistory.set(channel, []);
    }
    const history = this.eventHistory.get(channel)!;
    history.push(fullEvent);
    if (history.length > this.maxHistoryPerChannel) {
      history.splice(0, history.length - this.maxHistoryPerChannel);
    }

    const listeners = this.listeners.get(channel);
    if (!listeners || listeners.size === 0) return;

    const payload = `data: ${JSON.stringify(fullEvent)}\n\n`;
    const dead: SSEListener[] = [];

    for (const listener of listeners) {
      try {
        // Skip if targeting a specific user
        if (event.userId && listener.userId !== event.userId) continue;
        listener.controller.enqueue(new TextEncoder().encode(payload));
        listener.lastPing = Date.now();
      } catch {
        dead.push(listener);
      }
    }

    // Clean up dead connections
    for (const d of dead) listeners.delete(d);
  }

  /** Get recent events for a tenant (for reconnection catch-up) */
  getRecentEvents(tenantId: number, since?: number): SSEEvent[] {
    const channel = `tenant:${tenantId}`;
    const history = this.eventHistory.get(channel) ?? [];
    if (!since) return history;
    return history.filter(e => e.timestamp > since);
  }

  /** Get connection stats */
  getStats(): { channels: number; totalListeners: number } {
    let total = 0;
    for (const listeners of this.listeners.values()) {
      total += listeners.size;
    }
    return { channels: this.listeners.size, totalListeners: total };
  }
}

/** Singleton SSE bus */
export const sseBus = new SSEBus();
