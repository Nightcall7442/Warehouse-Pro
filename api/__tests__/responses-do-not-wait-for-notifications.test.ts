/**
 * Ответ на заказ, назначение курьера и смену статуса не ждёт Expo и Telegram.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Заказ уже был в базе, а агент у прилавка ждал: три push по ролям и
 * сообщение в Telegram, каждый с тайм-аутом 5 с — до 20 с при задержке
 * сторонних API (аудит A3/R14). Тайм-ауты спасали от «вечно», но не от
 * «долго». Теперь уведомления уходят после ответа: отказ — в журнал, а
 * Telegram вне рабочих часов и так ложится в outbox.
 *
 * Нарочная поломка: верни в order-create.ts `await notifyAboutNewOrder(` —
 * первый тест назовёт файл.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("уведомления — после ответа", () => {
  it("создание заказа: уведомления отпущены (void), ответ — сразу за ними", () => {
    const src = read("api/services/order-create.ts");
    expect(src).toContain("void notifyAboutNewOrder(db, {");
    expect(src).not.toContain("await notifyAboutNewOrder(");
    // return стоит сразу после отпущенного уведомления, а не после await'ов Expo/Telegram
    const at = src.indexOf("void notifyAboutNewOrder(");
    const ret = src.indexOf("return { id: orderId, orderNumber, total: orderTotal", at);
    expect(src.slice(at, ret)).not.toMatch(/\bawait\b/);
  });

  it("назначение курьера и смена статуса: ни одного await у push и Telegram на пути ответа", () => {
    for (const f of ["api/courier-router.ts", "api/services/order-status.ts"]) {
      const src = read(f);
      expect(src, f).not.toMatch(/await sendPushToUser\(/);
      expect(src, f).not.toMatch(/await notifyEvent\(/);
    }
  });

  it("тайм-ауты на сторонних вызовах остались — «после ответа» не значит «вечно»", () => {
    expect(read("api/services/push-service.ts")).toContain("signal: AbortSignal.timeout(EXPO_TIMEOUT_MS)");
    expect(read("api/lib/telegram.ts")).toMatch(/AbortSignal\.timeout\(TELEGRAM_TIMEOUT_MS\)/);
  });
});
