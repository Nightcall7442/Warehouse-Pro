/**
 * Что бренд принял — то и записал.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Схема входа перечисляла четырнадцать полей, а строка для базы собиралась
 * рядом, вручную, и в ней было восемь. Значок вкладки, заголовок и подзаголовок
 * экрана входа, текст подвала, домен и тема мобильного приложения проходили
 * проверку и молча исчезали: арендатор получал зелёное «Брендинг сохранён», а
 * после перезагрузки поля были пусты. Ошибки не было нигде — ни в журнале, ни
 * на экране.
 *
 * ── Почему проверка именно такая ────────────────────────────────────────────
 *
 * Пересчитывать поля списком здесь бессмысленно: список в тесте разойдётся с
 * жизнью ровно так же, как разошёлся список в роутере. Поэтому тест берёт
 * ключи ИЗ САМОЙ схемы входа, шлёт по значению на каждый и смотрит, что все
 * они дошли до базы. Появится пятнадцатое поле — оно попадёт в проверку само.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ __kind: "eq", col, val }),
}));

vi.mock("../lib/rate-limit", async () => (await import("./helpers/rate-limit-mock")).rateLimitMock());

vi.mock("../lib/feature-gating", () => ({
  hasSubscriptionAccess: vi.fn(async () => true),
  checkSubscriptionAccess: vi.fn(async () => true),
  invalidateSubscriptionAccess: vi.fn(),
}));

vi.mock("../lib/sanitize", () => ({
  sanitizeString: (s: string) => s.replace(/<[^>]*>/g, "").trim(),
  isSafeUrl: (u: string) => !u.toLowerCase().startsWith("javascript:"),
}));

import { asTestContext } from "./helpers/test-context";

/** Что ушло в базу за последний вызов. */
let inserted: Record<string, unknown> | null = null;
let updated: Record<string, unknown> | null = null;
/** Есть ли уже строка бренда у арендатора. */
let hasRow = false;

vi.mock("../queries/connection", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (hasRow ? [{ id: 1 }] : []),
        }),
      }),
    }),
    insert: () => ({
      values: async (v: Record<string, unknown>) => { inserted = v; },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: async () => { updated = v; },
      }),
    }),
  }),
}));

const ceoCtx = () => asTestContext({
  req: new Request("http://localhost/"),
  resHeaders: new Headers(),
  user: { id: 1, tenantId: 7, role: "ceo", status: "active", name: "Владелец", email: "o@t.com" },
  tenant: { id: 7, slug: "acme", name: "Acme", plan: "pro", status: "active" },
  db: null as unknown,
});

/** По значению на каждый вид поля — чтобы схема их приняла. */
const SAMPLE: Record<string, unknown> = {
  logoUrl:        "data:image/png;base64,AAAA",
  faviconUrl:     "data:image/png;base64,BBBB",
  primaryColor:   "#123456",
  secondaryColor: "#654321",
  appName:        "Складской учёт Акме",
  supportEmail:   "help@acme.uz",
  supportPhone:   "+998901234567",
  loginTitle:     "Добро пожаловать в Акме",
  loginSubtitle:  "Вход для сотрудников",
  footerText:     "© 2026 Акме",
  mobileTheme:    "dark",
};

beforeEach(() => { inserted = null; updated = null; hasRow = false; });

describe("бренд записывает всё, что принял", () => {
  it("каждое поле схемы доходит до базы при первом сохранении", async () => {
    const { tenantBrandingRouter } = await import("../tenant-branding-router");
    const caller = tenantBrandingRouter.createCaller(ceoCtx());


    await caller.update(SAMPLE as never);

    expect(inserted, "первое сохранение должно вставить строку").not.toBeNull();
    for (const key of Object.keys(SAMPLE)) {
      expect(inserted, `поле ${key} не дошло до базы`).toHaveProperty(key);
    }
    expect(inserted).toHaveProperty("tenantId", 7);
  });

  it("каждое поле схемы доходит до базы при правке существующей строки", async () => {
    hasRow = true;
    const { tenantBrandingRouter } = await import("../tenant-branding-router");
    const caller = tenantBrandingRouter.createCaller(ceoCtx());

    await caller.update(SAMPLE as never);

    expect(updated, "правка должна обновить строку").not.toBeNull();
    for (const key of Object.keys(SAMPLE)) {
      expect(updated, `поле ${key} не дошло до базы`).toHaveProperty(key);
    }
  });

  it("проверяемых полей столько же, сколько принимает схема", async () => {
    /*
      Страховка от забытого поля В САМОМ ТЕСТЕ: если в схему добавят
      пятнадцатое, а сюда образец не положат, проверки выше его не заметят.
    */
    const mod = await import("../tenant-branding-router");
    const shape = (mod as unknown as { brandingInputShape?: string[] }).brandingInputShape;
    expect(shape, "роутер должен называть свои поля — brandingInputShape").toBeDefined();
    expect([...shape!].sort()).toEqual(Object.keys(SAMPLE).sort());
  });
});

describe("незаполненная форма сохраняется", () => {
  /*
    Форма всегда шлёт объект целиком, и незаполненное поле в нём — пустая
    строка. Прежние проверки (companyName min(1), supportEmail .email())
    пустую строку не пропускали: НОВЫЙ арендатор не мог сохранить ни цвет,
    ни логотип, пока не заполнит почту поддержки и название компании.
  */
  it("пустые строки не мешают сохранить цвет", async () => {
    const { tenantBrandingRouter } = await import("../tenant-branding-router");
    const caller = tenantBrandingRouter.createCaller(ceoCtx());

    await caller.update({
      primaryColor: "#112233",
      appName: "",
      supportEmail: "",
      supportPhone: "",
      loginTitle: "",
      loginSubtitle: "",
      footerText: "",
      logoUrl: "",
      faviconUrl: "",
    } as never);

    expect(inserted).toHaveProperty("primaryColor", "#112233");
    expect(inserted, "пустое поле хранится как «не задано»").toHaveProperty("appName", null);
    expect(inserted).toHaveProperty("supportEmail", null);
  });

  it("непустая, но неверная почта по-прежнему отклоняется", async () => {
    const { tenantBrandingRouter } = await import("../tenant-branding-router");
    const caller = tenantBrandingRouter.createCaller(ceoCtx());

    await expect(caller.update({ supportEmail: "не-почта" } as never)).rejects.toThrow();
  });

  it("картинка размером с столбец отклоняется до базы", async () => {
    const { tenantBrandingRouter } = await import("../tenant-branding-router");
    const caller = tenantBrandingRouter.createCaller(ceoCtx());

    const huge = "data:image/png;base64," + "A".repeat(200_000);
    await expect(caller.update({ logoUrl: huge } as never)).rejects.toThrow();
    expect(inserted, "до базы дойти не должно").toBeNull();
  });
});

describe("форма не предлагает того, чего роутер не примет", () => {
  /*
    Обратная половина того же правила. Первая половина держит роутер: что
    принял — то записал. Эта держит форму: чего роутер не принимает, того
    экран не должен спрашивать.

    Так и появилась беда: в форме стояли «Компания» и домен, роутер их не
    писал (домен — вовсе не принимал), а арендатор видел поля и заполнял их.
  */
  it("каждое поле формы бренда роутер принимает", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/settings/BrandingSettings.tsx"),
      "utf8",
    );

    // Поля формы объявлены одним объектом DEFAULTS — из него и берём.
    const at = src.indexOf("const DEFAULTS = {");
    expect(at, "DEFAULTS в форме не найден — проверка была бы пустой").toBeGreaterThan(0);
    const block = src.slice(at, src.indexOf("};", at));
    const fields = [...block.matchAll(/^\s{2}(\w+):/gm)].map(m => m[1]);

    expect(fields.length, "поля формы не разобрались").toBeGreaterThan(5);

    const { brandingInputShape } = await import("../tenant-branding-router");
    const unknown = fields.filter(f => !brandingInputShape.includes(f));
    expect(
      unknown,
      `форма спрашивает то, чего роутер не сохранит: ${unknown.join(", ")}. ` +
      "Либо добавьте поле в brandingInput, либо уберите его с экрана — " +
      "заполненное поле, которое никуда не идёт, хуже отсутствующего.",
    ).toEqual([]);
  });
});
