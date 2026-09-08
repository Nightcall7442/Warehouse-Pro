/**
 * Молчание источника тревог — не спокойствие.
 *
 * Список тревог читается из AlertManager, и любая неудача запроса давала
 * пустой массив: недоступная служба, ответ 500, оборванная сеть, тайм-аут.
 * Страница получала [] и писала «Ничего не горит».
 *
 * То есть ровно в тот момент, когда наблюдение сломано, экран успокаивал
 * сильнее всего — и по нему нельзя было отличить исправную систему от
 * ослепшей. Здесь проверяется, что эти два случая различимы.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../lib/env", () => ({
  env: {
    alertmanagerUrl: "http://alertmanager.test:9093",
    alertmanagerInternalUrl: "",
    grafanaUrl: "",
    prometheusUrl: "",
    prometheusInternalUrl: "",
    jaegerUrl: "",
    sentryUrl: "",
    lokiUrl: "",
  },
}));

const { firingAlerts } = await import("../services/observability");

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
beforeEach(() => { vi.restoreAllMocks(); });

/** Ответ AlertManager с заданным телом. */
function respondWith(body: unknown, ok = true) {
  globalThis.fetch = vi.fn(async () => ({
    ok,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe("тревоги: пусто и неизвестно — разные вещи", () => {
  it("живой источник без тревог говорит, что он живой", async () => {
    respondWith([]);
    const r = await firingAlerts();
    expect(r.reachable).toBe(true);
    expect(r.alerts).toEqual([]);
  });

  it("оборванная сеть не выдаётся за спокойствие", async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    const r = await firingAlerts();
    expect(r.reachable, "сбой запроса снова читается как «ничего не горит»").toBe(false);
    expect(r.alerts).toEqual([]);
  });

  it("ответ с кодом ошибки — тоже «не знаем»", async () => {
    respondWith([], false);
    expect((await firingAlerts()).reachable).toBe(false);
  });

  it("незаданный адрес — «не знаем», а не «спокойно»", async () => {
    const env = (await import("../lib/env")).env as { alertmanagerUrl: string };
    const saved = env.alertmanagerUrl;
    env.alertmanagerUrl = "";
    try {
      expect((await firingAlerts()).reachable).toBe(false);
    } finally {
      env.alertmanagerUrl = saved;
    }
  });

  it("горящая тревога доезжает целиком", async () => {
    respondWith([{
      labels: { alertname: "HighErrorRate", severity: "critical" },
      annotations: { summary: "Доля 5xx выше 5%" },
      startsAt: "2026-09-08T10:00:00Z",
    }]);
    const r = await firingAlerts();
    expect(r.reachable).toBe(true);
    expect(r.alerts).toEqual([{
      name: "HighErrorRate",
      severity: "critical",
      summary: "Доля 5xx выше 5%",
      since: "2026-09-08T10:00:00Z",
    }]);
  });
});
