/**
 * Контроль: слово магазина и индекс риска.
 *
 * ── Что стережётся ──────────────────────────────────────────────────────────
 *
 *   · riskScore — чистая функция: каждый фактор даёт свои баллы, у каждого
 *     потолок, доли считаются от знаменателя и не срабатывают на малых числах,
 *     уровни по порогам, факторы отсортированы по весу, итог не выше 100;
 *   · блок слова магазина: кнопки только по доставленному заказу без слова;
 *     итог — когда слово есть; заметка экранируется; в печати скрыт;
 *   · кнопки — ТОЛЬКО на публичной странице: order.receipt (приложение
 *     сотрудника) зовёт receiptHtml без блока;
 *   · маршрут POST /r/:token/word смонтирован и ведёт обратно (303);
 *   · права: обзор, споры, тумблер — директор; обзор и споры — под assertControl;
 *   · карточка заказа несёт слово магазина; журнал действий знает control.*;
 *     меню, маршрут и раздел настроек на месте; миграция 0051 без хвоста.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { riskScore, levelOf, RISK, planAllowsControl, type RiskSignals } from "../services/control";

vi.mock("../lib/env", () => ({ env: { appSecret: "test-secret-for-receipts", appUrl: "https://app.example.test" } }));

const ROOT = join(__dirname, "..", "..");
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\S\r\n]*\/\/.*$/gm, "");
const read = (p: string) => strip(readFileSync(join(ROOT, p), "utf8"));
const NOW = new Date("2026-09-17T10:00:00Z");
const quiet: RiskSignals = {
  shortageCount: 0, shortageMoney: 0, onHand: 0, onHandSince: null,
  nonCashOverdueCount: 0, nonCashOverdueMoney: 0, delivered: 10, deliveredOld: 8, unconfirmed: 0, disputed: 0,
  reopened: 0, returned: 0, agentOrders: 10, discounted: 0, visits: 10, suspiciousVisits: 0,
};
const score = (p: Partial<RiskSignals>) => riskScore({ ...quiet, ...p }, NOW);

describe("индекс риска — чистая функция", () => {
  it("тишина — ноль и «спокойно»; тариф — пробный, Pro, Exclusive", () => {
    expect(score({})).toEqual({ score: 0, level: "calm", factors: [] });
    expect(["trial", "pro", "exclusive", "basic"].map(planAllowsControl)).toEqual([true, true, true, false]);
  });
  it("спор — 20 за каждый, потолок 40; недостача — 15 за документ, потолок 45; долг — 15 + доля лимита, потолок 35", () => {
    expect(score({ disputed: 1 }).factors).toEqual([{ code: "dispute", points: 20, count: 1 }]);
    expect(score({ disputed: 5 }).factors[0].points).toBe(40);
    expect(score({ shortageCount: 2, shortageMoney: 120000.456 }).factors).toEqual([{ code: "shortage", points: 30, count: 2, money: 120000.46 }]);
    expect(score({ shortageCount: 9 }).factors[0].points).toBe(45);
  });
  it("наличные: дольше суток — 15 с часами; сверх лимита — 10; без денег на руках — ничего", () => {
    const late = new Date(NOW.getTime() - 30 * 3_600_000), fresh = new Date(NOW.getTime() - 3 * 3_600_000);
    expect(score({ onHand: 300_000, onHandSince: late }).factors).toEqual([{ code: "cashLate", points: 15, money: 300000, hours: 30 }]);
    expect(score({ onHand: 300_000, onHandSince: null }).factors).toEqual([]);
    expect(score({ onHand: 300_000, onHandSince: fresh }).factors).toEqual([]);
    expect(score({ onHand: 0, onHandSince: late }).factors).toEqual([]);
  });
  it("безнал без выписки — 10 + 2 за каждый, потолок 20; переигранные заказы — 5 за каждый, потолок 20", () => {
    expect(score({ nonCashOverdueCount: 3, nonCashOverdueMoney: 900 }).factors).toEqual([{ code: "nonCash", points: 16, count: 3, money: 900 }]);
    expect(score({ nonCashOverdueCount: 30 }).factors[0].points).toBe(20);
    expect(score({ reopened: 2 }).factors).toEqual([{ code: "reopened", points: 10, count: 2 }]);
    expect(score({ reopened: 9 }).factors[0].points).toBe(20);
  });
  it("доли: не срабатывают на малых числах и ниже порога; срабатывают на пороге", () => {
    expect(score({ deliveredOld: 4, unconfirmed: 4 }).factors).toEqual([]);
    expect(score({ deliveredOld: 8, unconfirmed: 3 }).factors).toEqual([]);
    expect(score({ deliveredOld: 8, unconfirmed: 4 }).factors).toEqual([{ code: "unconfirmed", points: 10, count: 4, share: 0.5 }]);
    expect(score({ delivered: 8, returned: 2 }).factors).toEqual([]);
    expect(score({ delivered: 8, returned: 3 }).factors).toEqual([{ code: "returns", points: 10, count: 3, share: 0.27 }]);
    expect(score({ agentOrders: 4, discounted: 4 }).factors).toEqual([]);
    expect(score({ agentOrders: 6, discounted: 3 }).factors).toEqual([{ code: "discounts", points: 10, count: 3, share: 0.5 }]);
    expect(score({ visits: 4, suspiciousVisits: 4 }).factors).toEqual([]);
    expect(score({ visits: 10, suspiciousVisits: 3 }).factors).toEqual([{ code: "visits", points: 15, count: 3, share: 0.3 }]);
  });
  it("уровни по порогам; факторы по весу; итог не выше 100", () => {
    expect([0, 24, 25, 59, 60, 100].map(levelOf)).toEqual(["calm", "calm", "watch", "watch", "act", "act"]);
    expect(RISK.levels).toEqual({ watch: 25, act: 60 });
    const r = score({ disputed: 1, reopened: 1, shortageCount: 1 });
    expect(r.factors.map(f => f.code)).toEqual(["dispute", "shortage", "reopened"]);
    expect(r).toMatchObject({ score: 40, level: "watch" });
    const max = score({ disputed: 3, shortageCount: 3, onHand: 9_000_000, onHandSince: new Date("2026-09-10T10:00:00Z"), nonCashOverdueCount: 9, reopened: 9, unconfirmed: 8 });
    expect(max.score).toBe(100);
    expect(max.level).toBe("act");
  });
});

describe("слово магазина на чеке", () => {
  it("кнопки — по доставленному без слова; итог — когда слово есть; заметка экранируется; не доставлен — пусто", async () => {
    const { shopWordBlock } = await import("../services/receipt");
    const none = shopWordBlock("7.abc", { status: "delivered", shopConfirmedAt: null, shopDisputedAt: null, shopDisputeNote: null });
    expect(none).toContain('action="/r/7.abc/word"');
    expect(none).toContain('name="action" value="confirm"');
    expect(none).toContain('name="action" value="dispute"');
    expect(none).toContain('maxlength="300"');
    expect(shopWordBlock("7.abc", { status: "delivered", shopConfirmedAt: null, shopDisputedAt: null, shopDisputeNote: null }, "Напишите, что именно")).toContain('<div class="err">Напишите, что именно</div>');
    const ok = shopWordBlock("7.abc", { status: "delivered", shopConfirmedAt: new Date("2026-09-16T07:40:00Z"), shopDisputedAt: null, shopDisputeNote: null });
    expect(ok).toContain("Получение подтверждено 16.09.2026, 12:40");
    expect(ok).not.toContain("<form");
    const bad = shopWordBlock("7.abc", { status: "delivered", shopConfirmedAt: null, shopDisputedAt: new Date("2026-09-16T07:40:00Z"), shopDisputeNote: "<script>x</script> нет 2 ящиков" });
    expect(bad).toContain("Замечание отправлено поставщику");
    expect(bad).toContain("&lt;script&gt;x&lt;/script&gt; нет 2 ящиков");
    expect(bad).not.toContain("<script>");
    expect(shopWordBlock("7.abc", { status: "shipped", shopConfirmedAt: null, shopDisputedAt: null, shopDisputeNote: null })).toBe("");
  });
  it("в печати блок скрыт; в чеке для сотрудника (order.receipt) кнопок нет; публичная страница зовёт блок только при включённом контроле", () => {
    const r = read("api/services/receipt.ts");
    expect(r).toContain("@media print { .w { display: none; } }");
    expect(r).toContain("export async function receiptHtml(d: ReceiptData, extra = \"\")");
    expect(read("api/order-router.ts")).toContain("html: await receiptHtml(d) };");
    expect(r).toMatch(/if \(await controlEnabled\(db, row\.tenantId\)\) \{[\s\S]*?extra = shopWordBlock\(token, o, error\);/);
    expect(r).toContain("await shopWord(db, id, { action: input.action === \"dispute\" ? \"dispute\" : \"confirm\", note: input.note ?? null });");
  });
  it("маршрут POST /r/:token/word смонтирован и ведёт обратно 303; слово даётся один раз, только по доставленному, только при контроле", () => {
    const boot = read("api/boot.ts");
    expect(boot).toContain('app.post("/r/:token/word", async (c) => {');
    expect(boot).toContain("return c.redirect(r.redirect, 303);");
    const c = read("api/services/control.ts");
    expect(c).toContain('if (o.status !== "delivered") throw badRequest("Подтвердить можно только доставленный заказ");');
    expect(c).toContain('if (current !== "none") return { state: current, changed: false };');
    expect(c).toContain('if (!(await controlEnabled(db, o.tenantId))) throw badRequest(');
    expect(c).toContain('await notifyTenantRole(o.tenantId, "ceo",');
  });
});

describe("права, экраны и хозяйство", () => {
  it("обзор, споры, тумблер — директор; обзор и споры — под assertControl", () => {
    const router = read("api/control-router.ts");
    const proc = (name: string) => (router.match(new RegExp(`^  ${name}: (\\w+)`, "m")) ?? [])[1];
    expect(proc("setEnabled")).toBe("adminQuery");
    expect(proc("overview")).toBe("adminQuery");
    expect(proc("disputes")).toBe("adminQuery");
    expect(proc("money")).toBe("adminQuery");
    expect(proc("shortages")).toBe("adminQuery");
    expect(proc("status")).toBe("authedQuery");
    // Обзор, споры, деньги, недостачи — все четыре под assertControl.
    expect((router.match(/await assertControl\(getDb\(\), ctx\.tenant\.id, ctx\.tenant\.plan\);/g) ?? []).length).toBe(4);
    expect(read("api/router.ts")).toContain("control:      controlRouter,");
  });
  it("карточка заказа несёт слово магазина; журнал действий знает control.*", () => {
    expect(read("api/services/order-read.ts")).toContain("shopConfirmedAt: orders.shopConfirmedAt, shopDisputedAt: orders.shopDisputedAt, shopDisputeNote: orders.shopDisputeNote,");
    expect(read("src/pages/OrderDetail.tsx")).toContain('data-testid="shop-word"');
    const labels = read("contracts/audit-text.ts"), cfg = read("src/pages/AuditLog.tsx");
    for (const a of ["control.enabled", "control.disabled", "control.shop_confirmed", "control.shop_disputed"]) {
      expect(labels, a).toContain(`"${a}": { ru:`);
      expect(cfg, a).toContain(`"${a}":`);
    }
  });
  it("меню директора, маршрут, заголовок, раздел настроек — на месте; страница под тумблером", () => {
    // В группе «Финансы» бокового меню (19.09.2026 — меню собрано группами).
    expect(read("src/const.ts")).toContain('{ labelKey: "nav.control",    path: "/control",   icon: "ShieldCheck",    group: "finance" },');
    expect(read("src/App.tsx")).toContain('<Route path="/control" element={<RoleGuard roles={["ceo"]}><Control /></RoleGuard>} />');
    expect(read("src/components/Layout.tsx")).toContain('"/control":           { title: { ru: "Контроль", uz: "Nazorat" } },');
    expect(read("src/i18n/ru.ts")).toContain('control:     "Контроль",');
    expect(read("src/i18n/uz.ts")).toContain('control:     "Nazorat",');
    expect(read("src/pages/Settings.tsx")).toMatch(/key: "control", Icon: ShieldCheck, roles: \["ceo"\]/);
    expect(read("src/pages/Control.tsx")).toContain("const on = status.data?.enabled === true;");
    expect(read("src/components/settings/ControlSettings.tsx")).toContain("disabled={!planAllows || setEnabled.isPending}");
  });
  it("миграция 0051: три поля заказа, тумблер, без хвостового маркера", () => {
    const sql = readFileSync(join(ROOT, "db/migrations/0051_control.sql"), "utf8");
    expect(sql).toContain("ALTER TABLE `orders` ADD `shop_confirmed_at` timestamp;");
    expect(sql).toContain("ALTER TABLE `orders` ADD `shop_disputed_at` timestamp;");
    expect(sql).toContain("ALTER TABLE `orders` ADD `shop_dispute_note` varchar(300);");
    expect(sql).toContain("ALTER TABLE `settings` ADD `control_enabled` boolean DEFAULT false NOT NULL;");
    expect(sql.trimEnd().endsWith("--> statement-breakpoint")).toBe(false);
  });
});
