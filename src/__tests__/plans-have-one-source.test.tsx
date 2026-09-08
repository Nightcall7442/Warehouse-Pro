// @vitest-environment jsdom
/**
 * Про тариф везде написано одно и то же.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Цены и пределы жили в трёх местах: contracts/constants.ts (по ним приложение
 * считает доступ), карточки на лендинге строками — «299 000», «До 5
 * пользователей», — и словами в прозе. Совпадали они по случайности. Подними
 * цену в одном месте — лендинг продолжит обещать старую, а на экране оплаты
 * человек увидит другую; спор с ним будет проигран заранее, потому что скриншот
 * с обещанием у него останется.
 *
 * Правило «чат поддержки — это Exclusive» точно так же стояло проверкой доступа
 * на сервере и нигде на экране выбора тарифа.
 *
 * ── Чего не хватало ────────────────────────────────────────────────────────
 *
 * Предел по товарам не назывался на лендинге ВООБЩЕ. У Basic это 50 SKU, у
 * Pro — 100: для оптовика с тысячей позиций это главный вопрос к тарифу.
 *
 * А на экране оплаты не говорилось, что выбранный тариф может не вместить
 * нынешнюю нагрузку: организации с двенадцатью пользователями предлагался
 * Basic на пять, и узнала бы она об этом после оплаты.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PLANS, PLAN_PRICES_UZS, FEATURES, PLAN_ADDS, planFeatures, planHas } from "@contracts/constants";

const SRC = join(__dirname, "..");

function code(path: string): string {
  return readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("числа тарифа не переписаны от руки", () => {
  const landing = code(join(SRC, "components", "landing", "PricingSection.tsx"));

  it("лендинг берёт цены из общего источника", () => {
    expect(landing).toContain("PLAN_PRICES_UZS");
    // Цены строками — ровно то, что разъезжается молча.
    for (const price of Object.values(PLAN_PRICES_UZS)) {
      if (price === 0) continue;
      expect(landing).not.toContain(price.toLocaleString("ru"));
      expect(landing).not.toContain(String(price));
    }
  });

  it("лендинг берёт пределы из общего источника", () => {
    expect(landing).toContain("PLANS.basic.maxProducts");
    expect(landing).toContain("PLANS.pro.maxUsers");
  });

  it("предел по товарам на лендинге назван", () => {
    // Для оптовика это главный вопрос к тарифу, и ответа не было.
    expect(landing).toMatch(/SKU/);
  });
});

describe("что даёт тариф — одна запись на всех", () => {
  it("старший тариф наследует возможности младшего", () => {
    // Иначе карточку пришлось бы заполнять руками, и «Всё из Pro» разошлось бы
    // с тем, что в Pro на самом деле входит.
    for (const f of planFeatures("basic")) expect(planFeatures("pro")).toContain(f);
    for (const f of planFeatures("pro")) expect(planFeatures("exclusive")).toContain(f);
  });

  it("чат поддержки и API — только у Exclusive", () => {
    expect(planHas("exclusive", "supportChat")).toBe(true);
    expect(planHas("pro", "supportChat")).toBe(false);
    expect(planHas("exclusive", "api")).toBe(true);
    expect(planHas("basic", "api")).toBe(false);
  });

  it("каждая возможность названа на обоих языках", () => {
    for (const list of Object.values(PLAN_ADDS)) {
      for (const f of list) {
        expect(FEATURES[f].ru.length).toBeGreaterThan(0);
        expect(FEATURES[f].uz.length).toBeGreaterThan(0);
      }
    }
  });

  it("сервер решает доступ по каталогу, а не сравнением со строкой", () => {
    const service = code(join(SRC, "..", "api", "services", "support-chat.ts"));
    expect(service).toContain("planHas");
    expect(service).not.toMatch(/tenantPlan\([^)]*\)\)\s*===\s*"exclusive"/);

    const publicApi = code(join(SRC, "..", "api", "public-api.ts"));
    expect(publicApi).toContain('planHas(');
    expect(publicApi).not.toMatch(/plan\s*!==\s*"exclusive"/);
  });

  it("возможность, помеченная проверяемой, и правда проверяется кодом", () => {
    /*
      Признак enforced говорит, подкреплено ли обещание тарифа кодом. Пометить
      можно что угодно; проверка сверяет пометку с настоящими воротами, чтобы
      экран оплаты не обещал разграничения, которого нет.
    */
    const enforced = Object.entries(FEATURES).filter(([, v]) => v.enforced).map(([k]) => k);
    expect(enforced.sort()).toEqual(["api", "supportChat"]);

    const service = code(join(SRC, "..", "api", "services", "support-chat.ts"));
    expect(service).toContain('"supportChat"');
    const publicApi = code(join(SRC, "..", "api", "public-api.ts"));
    expect(publicApi).toContain('"api"');
  });
});

// ── Карточка тарифа ─────────────────────────────────────────────────────────

vi.mock("@/i18n", () => ({ useLang: () => ({ lang: "ru" }) }));

import { SubscriptionPlanCard } from "@/components/billing/SubscriptionPlanCard";

const basic = {
  key: "basic", name: "Basic", nameUz: "Basic",
  price: PLAN_PRICES_UZS.basic,
  maxUsers: PLANS.basic.maxUsers,
  maxProducts: PLANS.basic.maxProducts,
  maxOrdersMonth: PLANS.basic.maxOrdersMonth,
};
const t = (ru: string) => ru;
const noop = () => {};

beforeEach(cleanup);

describe("карточка тарифа", () => {
  it("предупреждает, что тариф не вместит нынешнюю нагрузку", () => {
    // Двенадцать человек в Basic на пять не поместятся. Сказать это надо ДО
    // оплаты, а не после.
    render(
      <SubscriptionPlanCard
        plan={basic} isCurrent={false} isPro={false}
        usage={{ users: 12, products: 10, orders: 5 }}
        planName={p => p.name} t={t} isPending={false} onSelect={noop}
      />,
    );
    expect(screen.getByText(/Не вместит/)).toBeTruthy();
    expect(screen.getByText(/12\/5/)).toBeTruthy();
  });

  it("молчит, когда всё помещается", () => {
    render(
      <SubscriptionPlanCard
        plan={basic} isCurrent={false} isPro={false}
        usage={{ users: 2, products: 10, orders: 5 }}
        planName={p => p.name} t={t} isPending={false} onSelect={noop}
      />,
    );
    expect(screen.queryByText(/Не вместит/)).toBeNull();
  });

  it("у текущего тарифа предупреждения нет — уходить всё равно некуда", () => {
    render(
      <SubscriptionPlanCard
        plan={basic} isCurrent
        isPro={false}
        usage={{ users: 12, products: 10, orders: 5 }}
        planName={p => p.name} t={t} isPending={false} onSelect={noop}
      />,
    );
    expect(screen.queryByText(/Не вместит/)).toBeNull();
    expect(screen.getByText("Активен")).toBeTruthy();
  });

  it("возможности тарифа перечислены, а не только числа", () => {
    const exclusive = { ...basic, key: "exclusive", name: "Exclusive", nameUz: "Exclusive", maxUsers: null, maxProducts: null, maxOrdersMonth: null };
    render(
      <SubscriptionPlanCard
        plan={exclusive} isCurrent={false} isPro={false}
        usage={{ users: 2, products: 10, orders: 5 }}
        planName={p => p.name} t={t} isPending={false} onSelect={noop}
      />,
    );
    // Единственное отличие Exclusive не числом — раньше о нём не говорилось.
    expect(screen.getByText(/Чат с поддержкой/)).toBeTruthy();
  });
});

describe("оформление раздела", () => {
  it("своего словаря оформления больше нет", () => {
    /*
      В components/billing/designTokens.ts имена теней были на ступень мимо
      настоящих (sm → --shadow-xs, md → --shadow-sm), «тёмная» поверхность была
      светлее обычной, а свечение вписывало числами RGB светлой палитры — в
      тёмной теме оно выходило сине-серым под золотой кнопкой.
    */
    expect(() => readFileSync(join(SRC, "components", "billing", "designTokens.ts"), "utf8")).toThrow();
  });

  it("в разделе не осталось цветов числом", () => {
    for (const file of ["Billing.tsx"]) {
      const src = code(join(SRC, "pages", file)).replace(/var\([^)]*\)/g, "");
      expect([...src.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(m => m[0])).toEqual([]);
    }
    for (const file of ["SubscriptionPlanCard", "HeroStatusCard", "UsageBar", "UsageSection", "DaysRing", "SkeletonBlock", "PaymentMethodsCard"]) {
      const src = code(join(SRC, "components", "billing", `${file}.tsx`)).replace(/var\([^)]*\)/g, "");
      expect([...src.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(m => m[0])).toEqual([]);
    }
  });
});
