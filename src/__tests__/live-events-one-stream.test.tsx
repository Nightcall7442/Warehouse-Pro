// @vitest-environment jsdom
/**
 * Живые события: один поток на вкладку, и по событию перечитывается нужное.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 *   · Поток /api/events открывали двое — провайдер запросов и колокольчик:
 *     две связи на вкладку при потолке сервера десять на человека. С шестой
 *     вкладки потоки выбивали друг друга.
 *   · Провайдер ждал order.created / order.status_changed, которых сервер не
 *     слал; перечитывал только order.list и три ручки Главной — плитки
 *     очередей (order.stats), «По агентам», «Контроль» не трогал.
 *   · Приход ехал внутри notification.new и прибавлял колокольчику единицу.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   · провайдер и колокольчик вместе — ровно один EventSource; событие
 *     доходит до обоих;
 *   · order.changed перечитывает всё, что двигает запись заказа, включая
 *     order.stats / agentSummary (префикс [["order"]]), Главную и «Контроль»;
 *     сто событий подряд — одно перечитывание;
 *   · после обрыва — переподключение и догон с последней метки;
 *   · arrival.completed колокольчик не трогает, а склад перечитывает.
 *
 * Нарочная поломка: верни в useNotifications свой new EventSource — падает
 * первый тест; убери "control" из ORDER_AFFECTED_ROUTERS или окно склейки —
 * падает второй.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { QueryClient } from "@tanstack/react-query";

class FakeEventSource {
  static all: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private handlers: Array<(m: { data: string }) => void> = [];
  url: string;
  constructor(url: string) { this.url = url; FakeEventSource.all.push(this); }
  addEventListener(type: string, fn: (m: { data: string }) => void) { if (type === "message") this.handlers.push(fn); }
  close() { this.closed = true; }
  send(e: Record<string, unknown>) { for (const fn of this.handlers) fn({ data: JSON.stringify(e) }); }
}
const open = () => FakeEventSource.all.filter(e => !e.closed);

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 5, role: "operator" } }) }));

beforeEach(() => {
  // Окно склейки живёт в модуле: каждому тесту — свой, без хвоста от соседа.
  vi.resetModules();
  FakeEventSource.all = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  // Запросы tRPC никуда не уходят: проверяется поток, а не ответы.
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("один поток на вкладку", () => {
  it("провайдер и колокольчик вместе — один EventSource; уведомление доходит до счётчика", async () => {
    const { TRPCProvider, queryClient } = await import("@/providers/trpc");
    const { useNotifications } = await import("@/hooks/useNotifications");
    queryClient.setQueryData([["notification", "unreadCount"], { type: "query" }], { count: 2 });
    function Bell() { return <span data-testid="bell">{useNotifications().unreadCount}</span>; }
    render(<TRPCProvider><Bell /></TRPCProvider>);

    expect(open()).toHaveLength(1);
    expect(open()[0].url).toBe("/api/events");
    expect(screen.getByTestId("bell").textContent).toBe("2");
    act(() => open()[0].send({ type: "notification.new", data: { id: 1 } }));
    expect(screen.getByTestId("bell").textContent).toBe("3");
    // Приход — не уведомление: колокольчик не прибавляет.
    act(() => open()[0].send({ type: "arrival.completed", data: { arrivalId: 4 } }));
    expect(screen.getByTestId("bell").textContent).toBe("3");
    act(() => open()[0].send({ type: "notification.new", data: { action: "read" } }));
    expect(screen.getByTestId("bell").textContent).toBe("2");
  });

  it("в коде экранов EventSource создаётся в одном месте", () => {
    const SRC = join(__dirname, "..");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) { if (f !== "__tests__") walk(p); continue; }
        if (/\.tsx?$/.test(f) && readFileSync(p, "utf8").includes("new EventSource(")) hits.push(p.slice(SRC.length + 1).replace(/\\/g, "/"));
      }
    };
    walk(SRC);
    expect(hits).toEqual(["lib/live-events.ts"]);
  });
});

describe("что перечитать по событию", () => {
  it("order.changed: заказы (список, плитки очередей, «По агентам»), Главная, «Контроль»; сто событий — одно перечитывание", async () => {
    vi.useFakeTimers();
    const { refreshFor, REFRESH_WINDOW_MS } = await import("@/lib/live-events");
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries").mockResolvedValue();
    for (let i = 0; i < 100; i++) refreshFor(qc, { type: "order.changed", data: {} });
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(REFRESH_WINDOW_MS);
    const keys = spy.mock.calls.map(c => JSON.stringify(c[0]?.queryKey));
    for (const k of ["order", "dashboard", "control", "shop", "courier"]) expect(keys).toContain(JSON.stringify([[k]]));
    // Каждый ключ — один раз, а не сто.
    expect(new Set(keys).size).toBe(keys.length);

    // [["order"]] — префикс: накрывает и плитки очередей, и «По агентам».
    const probe = new QueryClient();
    probe.setQueryData([["order", "stats"], { input: {}, type: "query" }], { pendingCount: 1 });
    probe.setQueryData([["order", "agentSummary"], { input: {}, type: "query" }], []);
    await probe.invalidateQueries({ queryKey: [["order"]] });
    expect(probe.getQueryCache().getAll().every(q => q.state.isInvalidated)).toBe(true);
  });

  it("arrival.completed — склад и товары; чужие виды — ничего", async () => {
    vi.useFakeTimers();
    const { refreshFor, REFRESH_WINDOW_MS } = await import("@/lib/live-events");
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries").mockResolvedValue();
    refreshFor(qc, { type: "arrival.completed" });
    refreshFor(qc, { type: "notification.new" });
    refreshFor(qc, { type: "connected" });
    vi.advanceTimersByTime(REFRESH_WINDOW_MS);
    expect(spy.mock.calls.map(c => JSON.stringify(c[0]?.queryKey)).sort()).toEqual(
      [[["product"]], [["warehouse"]], [["warehouseMulti"]], [["warehouseReports"]]].map(k => JSON.stringify(k)).sort(),
    );
  });
});

describe("обрыв", () => {
  it("через 5 с — новый поток, догон с последней метки раздаётся всем подписчикам", async () => {
    vi.useFakeTimers();
    const { connectLiveEvents, onLiveEvent } = await import("@/lib/live-events");
    const got: unknown[] = [];
    const off = onLiveEvent(e => got.push(e.type));
    const catchUp = vi.fn(async () => [{ type: "order.changed", timestamp: 2000 }]);
    const close = connectLiveEvents(catchUp);

    const first = open()[0];
    first.onopen?.();
    expect(catchUp).not.toHaveBeenCalled();           // первое подключение не догоняет
    first.send({ type: "notification.new", timestamp: 1000 });
    first.onerror?.();
    expect(open()).toHaveLength(0);
    vi.advanceTimersByTime(5000);
    expect(open()).toHaveLength(1);
    open()[0].onopen?.();
    await vi.waitFor(() => expect(got).toEqual(["notification.new", "order.changed"]));
    expect(catchUp).toHaveBeenCalledWith(1000);

    close(); off();
    expect(open()).toHaveLength(0);
  });
});
