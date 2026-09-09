import { describe, it, expect } from "vitest";
import { readFileSync, globSync } from "node:fs";
import { join } from "node:path";
import { tgMessages } from "../telegram-router";

/**
 * Суперадмин получает в Telegram больше, чем «Server Error».
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * В tgMessages лежало восемь шаблонов; вызывались четыре. newRegistration —
 * написан, ни разу не отправлен: регистрации шли молча. paymentReceived,
 * agentPlan, orderStatusChange — так же, годами. Шаблон без вызова выглядит
 * как работающее уведомление ровно до того дня, когда на него рассчитывают.
 *
 * Страж простой: каждый ключ tgMessages имеет хотя бы один вызов вне самого
 * telegram-router. Не хочешь вызывать — удали шаблон.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("у каждого шаблона Telegram есть вызов", () => {
  const files = globSync("api/**/*.ts", { cwd: process.cwd() })
    .map(f => f.replace(/\\/g, "/"))
    .filter(f => !f.includes("__tests__") && f !== "api/telegram-router.ts")
    .map(f => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""));

  for (const key of Object.keys(tgMessages)) {
    it(`tgMessages.${key} кто-то зовёт`, () => {
      const re = new RegExp("tgMessages\\." + key + "\\b");
      expect(files.some(src => re.test(src)), `шаблон ${key} мёртв — вызова нет`).toBe(true);
    });
  }
});

describe("регистрация доходит до суперадмина", () => {
  it("register шлёт newRegistration после транзакции, а не до", () => {
    const src = read("api/tenant-router.ts");
    const tx = src.indexOf("await db.transaction(async (tx) => {");
    const note = src.indexOf("tgMessages.newRegistration(");
    expect(tx).toBeGreaterThan(0);
    expect(note).toBeGreaterThan(tx);
  });
});

describe("шаблоны суперадмина экранируют всё, что подставлено", () => {
  it("название организации с <> не ломает сообщение", () => {
    const msg = tgMessages.trials([{ org: "ООО <Рога & Копыта>", days: 2 }], ["<b>x</b>"]);
    expect(msg).not.toContain("<Рога");
    expect(msg).toContain("&lt;Рога &amp; Копыта&gt;");
    expect(msg).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("сводка с нулями отправляется как есть — тишина тоже сведение", () => {
    const msg = tgMessages.adminDigest({
      registrations: 0, orders: 0, revenue: 0, unanswered: 0, trialsEnding: 0, pastDue: 0, activeTenants: 13,
    });
    expect(msg).toContain("Регистраций: 0");
    expect(msg).toContain("Активных организаций: 13");
  });

  it("серверу с догнанными миграциями — список, без них — одна строка", () => {
    expect(tgMessages.serverUp("abc1234def5678", [])).not.toContain("Догнаны");
    expect(tgMessages.serverUp("abc1234def5678", ["0009_courier_delivery_rate"])).toContain("0009_courier_delivery_rate");
  });
});
