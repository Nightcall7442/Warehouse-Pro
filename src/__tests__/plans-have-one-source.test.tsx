// @vitest-environment jsdom
/**
 * Про цену везде написано одно и то же — и всё это из contracts/pricing.ts.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Цены и пределы жили в нескольких местах: константы (по ним приложение
 * считает доступ), карточки на лендинге строками — «299 000», «До 5
 * пользователей», — проза на экране оплаты. Совпадали они по случайности.
 *
 * ── Что стало (05.10.2026, вариант «A») ─────────────────────────────────────
 *
 * Цена одна — 119 000 сум за полевого сотрудника, минимум трое, год −15 %,
 * прежние тарифы по прежней цене до 05.10.2027. Модуль один; лендинг, экран
 * подписки, экран блокировки, консоль, письма и справка показывают числа из
 * него. Ниже — страж: в коде нет ни одного переписанного числа цены, а
 * экраны рисуют ровно то, что посчитал модуль (примеры владельца: 7 → 833 000,
 * 26 → 3 094 000, 65 → 7 735 000).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { FEATURES, PLAN_ADDS, PRODUCT_FEATURES, SERVICE_FEATURES } from "@contracts/constants";
import {
  ANNUAL_DISCOUNT, FIELD_PRICE_UZS, GRANDFATHER_UNTIL, LEGACY_PRICES_UZS, MIN_FIELD_USERS,
  annualPrice, formatDay, formatSum, monthlyPrice, priceForTenant,
} from "@contracts/pricing";

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");

function code(path: string): string {
  return readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || name === "__tests__" || name === "dist") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

/** Число в любом написании: 119000, 119_000, «119 000» с обычным или неразрывным пробелом. */
const spelled = (n: number) => {
  const groups = formatSum(n).split(/\s/);
  return new RegExp(`(?<![\\d_])${groups.join("[\\s_\\u00a0\\u202f]?")}(?![\\d_])`);
};

// ── Страж: числа цены живут в одном месте ───────────────────────────────────

describe("числа цены не переписаны от руки", () => {
  const files = [...walk(SRC), ...walk(join(ROOT, "api")), ...walk(join(ROOT, "contracts"))]
    .filter(f => !f.endsWith(join("contracts", "pricing.ts")));
  const money = [FIELD_PRICE_UZS, monthlyPrice(MIN_FIELD_USERS), ...Object.values(LEGACY_PRICES_UZS)];

  it("страж видит файлы", () => {
    expect(files.length).toBeGreaterThan(300);
    expect(files.some(f => f.endsWith("PricingSection.tsx"))).toBe(true);
    expect(files.some(f => f.endsWith("FieldPlanCard.tsx"))).toBe(true);
  });

  it("119 000, 357 000 и цены прежних тарифов — только в contracts/pricing.ts", () => {
    const found: string[] = [];
    for (const f of files) {
      const src = code(f);
      for (const n of money) if (spelled(n).test(src)) found.push(`${relative(ROOT, f)}: ${formatSum(n)}`);
    }
    expect(found, "число цены переписано — возьмите его из contracts/pricing.ts").toEqual([]);
  });

  it("дата перехода — тоже одна", () => {
    const found = files.filter(f => /2027-10-05|05\.10\.2027/.test(code(f))).map(f => relative(ROOT, f));
    expect(found, "дата GRANDFATHER_UNTIL вписана руками").toEqual([]);
  });

  it("лендинг, экран подписки и консоль читают модуль цены", () => {
    for (const f of [
      "components/landing/PricingSection.tsx", "components/landing/SetupSection.tsx",
      "components/billing/FieldPlanCard.tsx", "components/billing/GrandfatherNotice.tsx",
      "components/superadmin/console/Payments.tsx", "components/superadmin/console/OrgTabs.tsx",
    ]) expect(code(join(SRC, f)), f).toContain("@contracts/pricing");
  });
});

describe("справка говорит те же числа, что модуль", () => {
  // Справку собирает Python из scripts/manual_content.py — импортировать
  // модуль он не может, поэтому совпадение проверяется здесь.
  const manual = readFileSync(join(ROOT, "scripts", "manual_content.py"), "utf8");
  const plain = (n: number) => formatSum(n).replace(/\s/g, " ");

  it("цена, минимум, скидка и дата", () => {
    expect(manual).toContain(`${plain(FIELD_PRICE_UZS)} сум в месяц`);
    expect(manual).toContain(`${plain(monthlyPrice(MIN_FIELD_USERS))} сум в месяц`);
    expect(manual).toContain(`минус ${Math.round(ANNUAL_DISCOUNT * 100)} %`);
    expect(manual).toContain(`до ${formatDay(GRANDFATHER_UNTIL)}`);
    expect(manual).toContain(`${plain(FIELD_PRICE_UZS)} so'm`);
  });
});

// ── Что даёт тариф ──────────────────────────────────────────────────────────

describe("что даёт тариф — одна запись на всех", () => {
  it("каждая возможность названа на обоих языках", () => {
    for (const list of Object.values(PLAN_ADDS)) {
      for (const f of list) {
        expect(FEATURES[f].ru.length).toBeGreaterThan(0);
        expect(FEATURES[f].uz.length).toBeGreaterThan(0);
      }
    }
  });

  it("сервер решает доступ по каталогу, а не сравнением со строкой", () => {
    const service = code(join(ROOT, "api", "services", "support-chat.ts"));
    expect(service).toContain("planHas");
    expect(service).not.toMatch(/tenantPlan\([^)]*\)\)\s*===\s*"exclusive"/);
    const publicApi = code(join(ROOT, "api", "public-api.ts"));
    expect(publicApi).toContain("planHas(");
    expect(publicApi).not.toMatch(/plan\s*!==\s*"exclusive"/);
    // Контроль и бот — по одному правилу, а не своими списками тарифов.
    for (const f of ["api/services/control.ts", "api/telegram/bot.ts", "api/cron/telegram-digest.ts", "api/cron/telegram-morning.ts"]) {
      const src = code(join(ROOT, f));
      expect(src, f).toMatch(/planHasProTools|plansWithProTools/);
      expect(src, f).not.toMatch(/\["trial", "pro", "exclusive"\]/);
    }
  });

  it("возможность, помеченная проверяемой, и правда проверяется кодом", () => {
    const enforced = Object.entries(FEATURES).filter(([, v]) => v.enforced).map(([k]) => k);
    expect(enforced.sort()).toEqual(["api", "supportChat"]);
    expect(code(join(ROOT, "api", "services", "support-chat.ts"))).toContain('"supportChat"');
    expect(code(join(ROOT, "api", "public-api.ts"))).toContain('"api"');
  });
});

// ── Экраны рисуют числа модуля ──────────────────────────────────────────────

const lang = vi.hoisted(() => ({ v: "ru" as "ru" | "uz" }));
vi.mock("@/i18n", () => ({
  useLang: () => ({ lang: lang.v }),
  useTranslate: () => (ru: string, uz: string) => (lang.v === "uz" ? uz : ru),
}));
vi.mock("@/components/landing/landing-anime", () => ({ useAnime: () => ({ current: null }) }));
vi.mock("react-router", () => ({ useNavigate: () => () => {} }));

const { FieldPlanCard } = await import("@/components/billing/FieldPlanCard");
const { GrandfatherNotice } = await import("@/components/billing/GrandfatherNotice");
const { default: PricingSection } = await import("@/components/landing/PricingSection");

beforeEach(() => { cleanup(); lang.v = "ru"; });
const text = (id: string) => screen.getByTestId(id).textContent ?? "";
const t = (ru: string) => ru;

describe("лендинг: одна цена и счётчик", () => {
  it("цена за человека и счётчик с двадцати: месяц и год", () => {
    render(<PricingSection />);
    expect(text("pricing-field-price")).toBe(formatSum(FIELD_PRICE_UZS));
    expect(text("pricing-calc-people")).toBe("20");
    expect(text("pricing-calc-month")).toBe(formatSum(2_380_000));
    expect(text("pricing-calc-year")).toBe(formatSum(annualPrice(20)));
  });

  it("примеры владельца — ровно его числа, и нажатие подставляет их в счётчик", () => {
    render(<PricingSection />);
    expect(text("pricing-example-7")).toContain(formatSum(833_000));
    expect(text("pricing-example-26")).toContain(formatSum(3_094_000));
    expect(text("pricing-example-65")).toContain(formatSum(7_735_000));
    expect(text("pricing-example-7")).toContain("5 агентов + 2 курьера");
    fireEvent.click(screen.getByTestId("pricing-example-65"));
    expect(text("pricing-calc-month")).toBe(formatSum(7_735_000));
    fireEvent.click(screen.getByTestId("pricing-calc-minus"));
    expect(text("pricing-calc-people")).toBe("64");
  });

  it("меньше минимума — считает как трое и говорит об этом", () => {
    render(<PricingSection />);
    fireEvent.change(screen.getByTestId("pricing-calc-range"), { target: { value: "1" } });
    expect(text("pricing-calc-month")).toBe(formatSum(357_000));
    expect(screen.getByTestId("landing-pricing").textContent).toContain("считаем как 3");
  });

  it("офис бесплатно, без ограничений, все функции, услуги по запросу; по-узбекски тоже", () => {
    render(<PricingSection />);
    const all = text("landing-pricing");
    for (const s of ["Офис, склад, супервайзеры и директор", "бесплатно", "без ограничений", "все включены", "−15%", "Услуги — по запросу"]) expect(all).toContain(s);
    for (const f of SERVICE_FEATURES) expect(all).toContain(FEATURES[f].ru);
    cleanup();
    lang.v = "uz";
    render(<PricingSection />);
    expect(text("landing-pricing")).toContain("bepul");
    expect(text("landing-pricing")).toContain(formatDay(GRANDFATHER_UNTIL));
  });
});

describe("экран подписки: карточка «Стандарт»", () => {
  it("по людям в поле: месяц и год со скидкой", () => {
    render(<FieldPlanCard fieldUsers={7} byRole={{ agent: 5, courier: 2, merchandiser: 0 }} mode="connect" isPending={false} onRequest={() => {}} t={t} />);
    expect(text("field-plan-price")).toBe(formatSum(FIELD_PRICE_UZS));
    expect(text("field-plan-month")).toContain(formatSum(833_000));
    expect(text("field-plan-year")).toContain(formatSum(8_496_600));
    expect(text("field-plan-role-agent")).toContain("5");
    expect(text("field-plan-card")).toContain("Все функции включены");
    for (const f of PRODUCT_FEATURES) expect(text("field-plan-card")).toContain(FEATURES[f].ru);
    expect(text("field-plan-card")).toContain("По запросу");
  });

  it("меньше трёх в поле — к оплате минимум, и это сказано", () => {
    render(<FieldPlanCard fieldUsers={1} byRole={{ agent: 1, courier: 0, merchandiser: 0 }} mode="connect" isPending={false} onRequest={() => {}} t={t} />);
    expect(text("field-plan-month")).toContain(formatSum(357_000));
    expect(text("field-plan-card")).toContain("Минимум — 3");
  });

  it("прежний тариф: дата и сумма, что будет потом", () => {
    render(<GrandfatherNotice planName="Pro" pricing={priceForTenant("pro", 7, new Date("2026-10-05T09:00:00Z"))} isPending={false} onRenew={() => {}} t={t} />);
    expect(text("grandfather-notice")).toContain(`Ваш тариф Pro действует по прежней цене до ${formatDay(GRANDFATHER_UNTIL)}`);
    expect(text("grandfather-next")).toBe(`7 → ${formatSum(833_000)} сум/мес`);
    expect(text("plan-request-pro")).toContain(formatSum(LEGACY_PRICES_UZS.pro));
  });
});

describe("оформление раздела", () => {
  it("своего словаря оформления больше нет", () => {
    expect(() => readFileSync(join(SRC, "components", "billing", "designTokens.ts"), "utf8")).toThrow();
  });

  it("в разделе не осталось цветов числом", () => {
    const files = [join(SRC, "pages", "Billing.tsx"), join(SRC, "pages", "SubscriptionBlocked.tsx"),
      ...["FieldPlanCard", "GrandfatherNotice", "HeroStatusCard", "UsageBar", "UsageSection", "DaysRing", "SkeletonBlock", "PaymentMethodsCard"]
        .map(f => join(SRC, "components", "billing", `${f}.tsx`))];
    for (const f of files) {
      const src = code(f).replace(/var\([^)]*\)/g, "");
      expect([...src.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)].map(m => m[0]), f).toEqual([]);
    }
  });
});
