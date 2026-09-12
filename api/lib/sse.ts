import { subscribeChannel, publishChannel, INSTANCE_ID } from "./redis";

export type SSEEventType =
  | "order.created"
  | "order.status_changed"
  | "agent.location_updated"
  | "stock.low"
  | "notification.new"
  | "plan.updated"
  /*
    Ответ поддержки. Адресуется конкретному пользователю (userId обязателен):
    разговор с платформой у каждого свой, и общее по организации событие
    показало бы агенту, что директор о чём-то переписывается.
  */
  | "support.message";

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

/*
  Событие в Redis несёт метку процесса-отправителя. Без неё отправитель
  получал бы своё же событие обратно и раздавал его слушателям второй раз —
  ровно это и случилось бы в тот день, когда подписка наконец заработала.
*/
type WireEvent = SSEEvent & { origin: string };

/**
 * Адресовано ли событие этому пользователю.
 *
 * Событие без userId — общее для организации (новый приход, низкий остаток).
 * Событие с userId — личное: уведомление курьеру о назначенной доставке,
 * координаты конкретного агента.
 *
 * Правило одно на живую рассылку и на догон истории. Раньше оно существовало
 * только в рассылке, и догон отдавал всё подряд — то есть дыра открывалась
 * ровно там, где её никто не искал.
 */
function isVisibleTo(event: SSEEvent, userId: number): boolean {
  return !event.userId || event.userId === userId;
}

export class SSEBus {
  private listeners = new Map<string, Set<SSEListener>>();
  private eventHistory = new Map<string, SSEEvent[]>();
  private maxHistoryPerChannel = 50;
  private historyTTL = 5 * 60 * 1000;
  private lastEviction = Date.now();
  private evictionInterval = 60 * 1000;
  private redisSubscribed = false;
  private readonly origin: string;

  constructor(origin: string = INSTANCE_ID) {
    this.origin = origin;
  }

  /*
    Подписка ленивая — при первом emit/subscribe после того, как Redis поднят.
    В конструкторе она стояла зря: модуль импортируется раньше connectRedis(),
    и подписка не ставилась никогда (см. lib/redis.ts, subscribeChannel).
  */
  private ensureRedis(): void {
    if (this.redisSubscribed) return;
    this.redisSubscribed = subscribeChannel(REDIS_SSE_CHANNEL, this.onWire);
  }

  /** Событие с другой реплики: слушателям и в историю (для догона после обрыва). */
  private readonly onWire = (message: string): void => {
    let event: WireEvent;
    try { event = JSON.parse(message); } catch { return; }
    if (event.origin === this.origin) return;
    const { origin: _o, ...local } = event;
    void _o;
    this.remember(local);
    this.dispatchToLocalListeners(local);
  };

  private remember(event: SSEEvent): void {
    const channel = `tenant:${event.tenantId}`;
    if (!this.eventHistory.has(channel)) {
      this.eventHistory.set(channel, []);
    }
    const history = this.eventHistory.get(channel)!;
    history.push(event);
    if (history.length > this.maxHistoryPerChannel) {
      history.splice(0, history.length - this.maxHistoryPerChannel);
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
        if (!isVisibleTo(event, listener.userId)) continue;
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
    this.ensureRedis();
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
    this.ensureRedis();

    const fullEvent: SSEEvent = { ...event, timestamp: Date.now() };
    this.remember(fullEvent);
    this.dispatchToLocalListeners(fullEvent);

    // Остальным репликам — с меткой отправителя, чтобы себе не раздать дважды.
    const wire: WireEvent = { ...fullEvent, origin: this.origin };
    publishChannel(REDIS_SSE_CHANNEL, JSON.stringify(wire));
  }

  /**
   * События организации, которые вправе увидеть этот пользователь.
   *
   * `userId` обязателен намеренно. Раньше его здесь не было вовсе, и история
   * канала отдавалась целиком: живая рассылка честно фильтровала адресные
   * события (см. dispatchToLocalListeners), а догон после переподключения —
   * нет. Через sse.recentEvents любой вошедший пользователь получал события
   * agent.location_updated со всех агентов организации — то есть их GPS,
   * закрытый в getLocations и getTrail ролью супервайзера, — а заодно
   * персональные уведомления, адресованные директору.
   *
   * Сделать параметр обязательным, а не необязательным с умолчанием, — тот же
   * приём, что и с калиткой подписки: забыть передать нельзя, компилятор не
   * пустит. Оба вызывающих места пользователя знают.
   */
  getRecentEvents(tenantId: number, userId: number, since?: number): SSEEvent[] {
    const channel = `tenant:${tenantId}`;
    const history = this.eventHistory.get(channel) ?? [];
    return history.filter(e =>
      isVisibleTo(e, userId) && (since === undefined || e.timestamp > since));
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
