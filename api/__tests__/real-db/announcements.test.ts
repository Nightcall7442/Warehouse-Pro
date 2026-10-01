import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import * as schema from "@db/schema";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, ctxFor, type ServiceDb } from "./harness";
import { cache } from "../../lib/cache";
import { ANNOUNCEMENTS_CACHE_KEY } from "../../services/announcements";

/**
 * Объявления организациям — на настоящей базе, через настоящие ручки.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Сказать всем клиентам «в субботу ночью обновление» можно было только
 * письмом каждому директору; агенты и операторы не узнавали вовсе.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   · адресность: всем, по тарифу (по тарифу организации), выбранным
 *     организациям — чужой не видит;
 *   · сроки: запланированное не видно до начала, истёкшее и завершённое
 *     («Завершить сейчас») — не видно;
 *   · закрытие одним человеком не прячет объявление от коллеги той же
 *     организации; закрывший не видит его и после повторного запроса (сервер,
 *     не localStorage); повторное закрытие — не ошибка;
 *   · суперадмину «активные мне» пусты всегда;
 *   · узбекский текст отдаётся вместе с русским; узбекский только парой;
 *   · новое объявление видно сразу (минутная копия сброшена), завершённое —
 *     пропадает сразу; управление — только суперадмину.
 *
 * Нарочная поломка: в addressedTo вернуть true для «plans» — падает
 * «адресность»; не фильтровать по startsAt — падает «сроки»; хранить
 * закрытие по организации, а не по человеку — падает «закрытие»; убрать
 * проверку роли в activeFor — падает «суперадмину».
 */
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

const HOUR = 3_600_000;

describe.skipIf(!hasRealDb)("объявления организациям", () => {
  let db: ServiceDb;
  const d = () => db as any;
  let systemId = 0;
  let pro = 0, basic = 0, other = 0;
  let proCeo = 0, proOperator = 0, basicCeo = 0, otherCeo = 0;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    cache.invalidate(ANNOUNCEMENTS_CACHE_KEY);
    const [sys] = await d().insert(schema.tenants).values({ slug: "system", name: "Платформа" });
    systemId = Number(sys.insertId);
    const t = async (slug: string, plan: "pro" | "basic") => Number((await d().insert(schema.tenants).values({ slug, name: slug, plan }))[0].insertId);
    const u = async (tenantId: number, role: string, email: string) => Number((await d().insert(schema.users).values({ tenantId, name: role, email, passwordHash: "x", role }))[0].insertId);
    pro = await t("pro-co", "pro"); basic = await t("basic-co", "basic"); other = await t("other-co", "basic");
    proCeo = await u(pro, "ceo", "ceo@pro.uz"); proOperator = await u(pro, "operator", "op@pro.uz");
    basicCeo = await u(basic, "ceo", "ceo@basic.uz"); otherCeo = await u(other, "ceo", "ceo@other.uz");
  });

  const ctx = (tenantId: number, userId: number, role: string, plan: string) => {
    const c = ctxFor(db, tenantId, userId, role);
    c.tenant.plan = plan;
    return c;
  };
  const admin = async () => (await import("../../platform-router")).platformRouter.createCaller(ctxFor(db, systemId, 1, "superadmin"));
  const mine = async (tenantId: number, userId: number, role = "ceo", plan = "basic") =>
    (await import("../../platform-router")).announcementRouter.createCaller(ctx(tenantId, userId, role, plan));
  const titles = async (tenantId: number, userId: number, role = "ceo", plan = "basic") =>
    (await (await mine(tenantId, userId, role, plan)).active()).map(a => a.title).sort();

  it("адресность: всем, по тарифу, выбранным — чужой не видит", async () => {
    const a = await admin();
    await a.createAnnouncement({ title: "Всем", body: "текст", level: "info", audience: "all" });
    await a.createAnnouncement({ title: "Только Про", body: "текст", level: "warning", audience: "plans", plans: ["pro", "exclusive"] });
    await a.createAnnouncement({ title: "Только Базовый-ко", body: "текст", level: "info", audience: "tenants", tenantIds: [basic] });

    expect(await titles(pro, proCeo, "ceo", "pro")).toEqual(["Всем", "Только Про"]);
    expect(await titles(basic, basicCeo, "ceo", "basic")).toEqual(["Всем", "Только Базовый-ко"]);
    expect(await titles(other, otherCeo, "ceo", "basic")).toEqual(["Всем"]);
  });

  it("сроки: запланированное — с начала, истёкшее и завершённое — нет", async () => {
    const a = await admin();
    await a.createAnnouncement({ title: "Завтра", body: "т", level: "info", audience: "all", startsAt: new Date(Date.now() + 24 * HOUR) });
    const now = await a.createAnnouncement({ title: "Сейчас", body: "т", level: "info", audience: "all", endsAt: new Date(Date.now() + HOUR) });
    await d().insert(schema.announcements).values({ title: "Вчера", body: "т", startsAt: new Date(Date.now() - 48 * HOUR), endsAt: new Date(Date.now() - 24 * HOUR) });
    cache.invalidate(ANNOUNCEMENTS_CACHE_KEY);
    expect(await titles(basic, basicCeo)).toEqual(["Сейчас"]);

    await a.endAnnouncement({ id: now.id });
    expect(await titles(basic, basicCeo)).toEqual([]);
    const all = await a.announcements();
    expect(all.find(x => x.title === "Сейчас")!.endedAt).toBeInstanceOf(Date);

    await expect(a.createAnnouncement({ title: "Наоборот", body: "т", level: "info", audience: "all", startsAt: new Date(Date.now() + 2 * HOUR), endsAt: new Date(Date.now() + HOUR) }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("закрытие: одному человеку — не всем; на сервере; повтор не ошибка", async () => {
    const a = await admin();
    const ann = await a.createAnnouncement({ title: "Новая накладная", body: "т", level: "info", audience: "all" });
    const ceoSide = await mine(pro, proCeo, "ceo", "pro");
    await ceoSide.dismiss({ id: ann.id });
    await ceoSide.dismiss({ id: ann.id });
    // Закрывший не видит — с любого устройства: спрашивает сервер.
    expect(await titles(pro, proCeo, "ceo", "pro")).toEqual([]);
    // Его оператор — видит, пока не закроет сам.
    expect(await titles(pro, proOperator, "operator", "pro")).toEqual(["Новая накладная"]);
    expect((await a.announcements())[0].dismissed).toBe(1);
    await expect(ceoSide.dismiss({ id: 999_999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("суперадмину «активные мне» пусты; управление — только ему", async () => {
    const a = await admin();
    await a.createAnnouncement({ title: "Всем", body: "т", level: "info", audience: "all" });
    expect(await (await mine(systemId, 1, "superadmin", "exclusive")).active()).toEqual([]);
    const { platformRouter } = await import("../../platform-router");
    const ceo = platformRouter.createCaller(ctx(pro, proCeo, "ceo", "pro"));
    await expect(ceo.createAnnouncement({ title: "Взлом", body: "т", level: "info", audience: "all" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(ceo.announcements()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("узбекский: отдаётся вместе с русским; только парой", async () => {
    const a = await admin();
    await a.createAnnouncement({ title: "Обновление", body: "В субботу ночью.", titleUz: "Yangilanish", bodyUz: "Shanba kuni tunda.", level: "warning", audience: "all" });
    const [got] = await (await mine(basic, basicCeo)).active();
    expect(got).toMatchObject({ title: "Обновление", body: "В субботу ночью.", titleUz: "Yangilanish", bodyUz: "Shanba kuni tunda.", level: "warning" });
    await expect(a.createAnnouncement({ title: "Половина", body: "т", titleUz: "Faqat sarlavha", level: "info", audience: "all" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(a.createAnnouncement({ title: "Пусто", body: "т", level: "info", audience: "plans", plans: [] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
