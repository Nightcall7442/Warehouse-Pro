import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { SIGNUP_SOURCE_MAX } from "@contracts/signup";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, type ServiceDb } from "./harness";

/**
 * Метки рекламы до записи в базу — настоящим путём (HTTP → tRPC → MySQL).
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Регистрация записывала в tenants.signup_source только utm_source и ref;
 * канал и кампанию рекламы терялись. Заявка «перезвоните» с лендинга меток не
 * несла вовсе, а столбца для них у leads не было.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   · регистрация с utm_medium и utm_campaign — все пять пар в signup_source;
 *   · пять меток по 60 знаков — строка больше varchar(200): регистрация
 *     проходит, лишнее отброшено целыми парами, строка ≤ 200 и легла в базу
 *     (без отбрасывания MySQL в строгом режиме уронил бы вставку);
 *   · метка длиннее 200 до чистки — отброшена (`catch`), а не отказ;
 *   · заявка с attribution — leads.utm той же строкой, в Telegram строка
 *     «Метки: …» словами; без attribution — utm null; кривая attribution —
 *     заявка всё равно принята.
 *
 * Нарочная поломка: убрать отбрасывание пар в composeSignupSource — падает
 * «пять длинных меток» (ER_DATA_TOO_LONG); не передавать utm в recordLead —
 * «заявка с метками»; снять `.catch(undefined)` у leadAttribution — «кривые
 * метки».
 */
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));
vi.mock("../../lib/rate-limit", async () => (await import("../helpers/rate-limit-mock")).rateLimitMock());
vi.mock("../../lib/mailer", () => ({
  sendVerifyEmail: vi.fn(async () => {}),
  sendEmail: vi.fn(async () => {}),
}));
vi.mock("../../lib/env", async (orig) => {
  const real = await orig<{ env: Record<string, unknown> }>();
  const over: Record<string, unknown> = {
    appUrl: "https://wp.test", appSecret: "тест-секрет-0123456789abcdef0123456789",
    telegramBotToken: "test-token", telegramAdminChatId: "777",
  };
  return { env: new Proxy(real.env, { get: (o, k) => (k in over ? over[k as string] : o[k as string]) }) };
});

const tg = vi.hoisted(() => ({ sent: [] as Array<{ chat_id: string; text: string }> }));
const realFetch = globalThis.fetch;

describe.skipIf(!hasRealDb)("метки рекламы на настоящей базе", () => {
  let db: ServiceDb;
  const d = () => db as any;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    tg.sent.length = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url instanceof Request ? url.url : url);
      if (!href.startsWith("https://api.telegram.org/")) return realFetch(url, init);
      tg.sent.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const app = async () => (await import("../../boot")).default;
  const trpcPost = async (path: string, input: unknown) => {
    const res = await (await app()).request(`/api/trpc/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ json: input }),
    });
    const body = await res.json() as any;
    return { status: res.status, body };
  };

  const form = (source: Record<string, unknown>) => ({
    orgName: "Хорезм-опт", name: "Санжар", email: "sanjar@opt.uz", password: "пароль-восемь",
    phone: "+998 90 123 45 67", source,
  });
  const tenantSource = async () =>
    ((await d().select({ s: schema.tenants.signupSource }).from(schema.tenants).where(eq(schema.tenants.name, "Хорезм-опт")))[0])?.s as string | null | undefined;
  const leadRows = async () => d().select().from(schema.leads) as Promise<schema.Lead[]>;

  it("регистрация: канал и кампания — в signup_source по порядку", async () => {
    const r = await trpcPost("tenant.register", form({ answer: "instagram", utmSource: "ig", utmMedium: "cpc", utmCampaign: "okt_2026", ref: "bekzod" }));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await tenantSource()).toBe("answer=instagram; utm_source=ig; utm_medium=cpc; utm_campaign=okt_2026; ref=bekzod");
  });

  it("пять длинных меток: регистрация проходит, строка не длиннее столбца", async () => {
    const t = (c: string) => c.repeat(60);
    const r = await trpcPost("tenant.register", form({ answer: "instagram", utmSource: t("s"), utmMedium: t("m"), utmCampaign: t("c"), ref: t("r") }));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const s = await tenantSource();
    expect(s).toBeTruthy();
    expect(s!.length).toBeLessThanOrEqual(SIGNUP_SOURCE_MAX);
    expect(s).toBe(`answer=instagram; utm_source=${t("s")}; ref=${t("r")}`);
  });

  it("метка длиннее 200 до чистки — отброшена, регистрация на месте", async () => {
    const r = await trpcPost("tenant.register", form({ utmSource: "ig", utmCampaign: "x".repeat(300) }));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await tenantSource()).toBe("utm_source=ig");
  });

  it("заявка с метками: leads.utm той же строкой, в Telegram — «Метки:» словами", async () => {
    const r = await trpcPost("lead.create", {
      name: "Санжар", phone: "+998 90 123 45 67", source: "pilot",
      attribution: { utmSource: "ig<script>", utmMedium: "cpc", utmCampaign: "okt", ref: "bekzod" },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const [lead] = await leadRows();
    expect(lead.source).toBe("pilot");
    expect(lead.utm).toBe("utm_source=igscript; utm_medium=cpc; utm_campaign=okt; ref=bekzod");
    await vi.waitFor(() => expect(tg.sent).toHaveLength(1));
    expect(tg.sent[0].text).toContain("Метки: utm_source: igscript · utm_medium: cpc · utm_campaign: okt · ref: bekzod");
    expect(tg.sent[0].text).not.toContain("<script>");
  });

  it("заявка без меток — utm пуст, строки «Метки» нет", async () => {
    const r = await trpcPost("lead.create", { name: "Санжар", phone: "+998 90 123 45 67", source: "hero" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const [lead] = await leadRows();
    expect(lead.utm).toBeNull();
    await vi.waitFor(() => expect(tg.sent).toHaveLength(1));
    expect(tg.sent[0].text).not.toContain("Метки");
  });

  it("кривые метки — заявка всё равно принята, длинная метка отброшена", async () => {
    const long = await trpcPost("lead.create", {
      name: "Санжар", phone: "+998 90 123 45 67", attribution: { utmSource: "ig", utmCampaign: "x".repeat(500) },
    });
    expect(long.status, JSON.stringify(long.body)).toBe(200);
    const notObject = await trpcPost("lead.create", { name: "Дилноза", phone: "+998 91 765 43 21", attribution: "utm_source=ig" });
    expect(notObject.status, JSON.stringify(notObject.body)).toBe(200);
    const rows = await leadRows();
    expect(rows.map(l => [l.name, l.utm]).sort()).toEqual([["Дилноза", null], ["Санжар", "utm_source=ig"]]);
  });

  it("пять длинных меток у заявки — строка не длиннее столбца", async () => {
    const t = (c: string) => c.repeat(60);
    const r = await trpcPost("lead.create", {
      name: "Санжар", phone: "+998 90 123 45 67",
      attribution: { utmSource: t("s"), utmMedium: t("m"), utmCampaign: t("c"), ref: t("r") },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const [lead] = await leadRows();
    expect(lead.utm!.length).toBeLessThanOrEqual(SIGNUP_SOURCE_MAX);
    // Без канала было бы 212 знаков — уходит и кампания.
    expect(lead.utm).toBe(`utm_source=${t("s")}; ref=${t("r")}`);
  });
});
