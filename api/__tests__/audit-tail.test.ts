import { describe, it, expect, vi } from "vitest";
import { generateTotpSecret, totpCode, verifyTotpOnce, matchTotp, TOTP_STEP_SECONDS } from "../lib/totp";
import { sseBus, SSE_MAX_PER_USER } from "../lib/sse";

// vi.mock поднимается выше импортов — всё, что он читает, тоже через vi.hoisted.
const gate = await vi.hoisted(async () => {
  const { createHash } = await import("node:crypto");
  const secret = "s3cret-for-tests";
  return { allowed: true, status: "active" as string, secret, hash: createHash("sha256").update(secret).digest("hex") };
});
vi.mock("../queries/connection", () => ({
  getDb: () => ({
    // Таблица узнаётся по колонке: onecConfig несёт webhookSecretHash, tenants — status.
    select: () => ({ from: (t: object) => ({ where: () => ({ limit: async () =>
      "webhookSecretHash" in t ? [{ tenantId: 1, secretHash: gate.hash }] : [{ status: gate.status }],
    }) }) }),
  }),
}));
vi.mock("../lib/feature-gating", () => ({ hasSubscriptionAccess: async () => gate.allowed }));

/**
 * Хвост аудита 20.09.2026.
 *
 *  • код второго фактора принимается один раз: в окне ±30 с тот же код
 *    входил повторно — подсмотренный через плечо код жил ещё минуту;
 *  • SSE: подключений на человека не считали — теперь потолок, самое старое
 *    закрывается;
 *  • 1С-вебхук проводил платежи и остатки у приостановленной или
 *    неоплаченной организации — теперь отказ до обработчиков.
 *
 * Нарочная поломка: в verifyTotpOnce убери проверку `counter <= last.counter`
 * — упадёт «повтор»; убери закрытие oldest в sse.subscribe — упадёт
 * «потолок»; убери проверку подписки в webhooks/onec.ts — упадёт «1С».
 */

describe("второй фактор: один код — один вход", () => {
  const secret = generateTotpSecret();
  const now = Date.UTC(2026, 8, 20, 12, 0, 0);
  const code = totpCode(secret, now);

  it("тот же код второй раз в окне — отказ; следующий шаг — проходит; другой человек — независимо", () => {
    expect(verifyTotpOnce(7, secret, code, now)).toBe(true);
    expect(verifyTotpOnce(7, secret, code, now + 5_000), "повтор кода прошёл").toBe(false);
    expect(verifyTotpOnce(7, secret, code, now + 20_000), "повтор кода прошёл в том же окне").toBe(false);
    const next = totpCode(secret, now + TOTP_STEP_SECONDS * 1000);
    expect(verifyTotpOnce(7, secret, next, now + TOTP_STEP_SECONDS * 1000)).toBe(true);
    expect(verifyTotpOnce(8, secret, next, now + TOTP_STEP_SECONDS * 1000), "счётчик одного человека мешает другому").toBe(true);
    expect(verifyTotpOnce(7, secret, "000000", now)).toBe(false);
  });

  it("matchTotp называет шаг кода, а не только «верен»", () => {
    expect(matchTotp(secret, code, now)).toBe(Math.floor(now / 1000 / TOTP_STEP_SECONDS));
    expect(matchTotp(secret, "12 34 56", now)).toBeNull();
  });
});

describe("SSE: потолок подключений на человека", () => {
  it("одиннадцатое подключение закрывает самое старое; событие получают десять", () => {
    const tenant = 9_100, user = 5;
    const made: Array<{ closed: boolean; got: number }> = [];
    const stops: Array<() => void> = [];
    for (let i = 0; i < SSE_MAX_PER_USER + 1; i++) {
      const rec = { closed: false, got: 0 };
      made.push(rec);
      const controller = { enqueue: () => { rec.got++; }, close: () => { rec.closed = true; } } as unknown as ReadableStreamDefaultController;
      stops.push(sseBus.subscribe(tenant, user, controller));
    }
    expect(made[0].closed, "самое старое не закрыто").toBe(true);
    expect(made.slice(1).every(m => !m.closed)).toBe(true);
    sseBus.emit({ type: "stock.low", tenantId: tenant, data: { productId: 1 } } as never);
    expect(made.filter(m => m.got > 0)).toHaveLength(SSE_MAX_PER_USER);
    expect(made[0].got, "закрытому подключению всё ещё шлют").toBe(0);
    for (const s of stops) s();
  });
});

describe("1С-вебхук и подписка", () => {
  const call = async () => {
    const { default: app } = await import("../webhooks/onec");
    return app.request("/nowhere", { method: "POST", headers: { "X-1C-Secret": gate.secret, "content-type": "application/json" }, body: "{}" });
  };

  it("действующая организация с подпиской — пропускается к обработчикам", async () => {
    gate.allowed = true; gate.status = "active";
    expect((await call()).status).toBe(404); // прошли middleware, маршрута нет
  });
  it("без подписки — 402, приостановленная — 403", async () => {
    gate.allowed = false; gate.status = "active";
    expect((await call()).status).toBe(402);
    gate.allowed = true; gate.status = "suspended";
    expect((await call()).status).toBe(403);
  });
});
