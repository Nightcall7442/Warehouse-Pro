// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { readFileSync, readdirSync } from "node:fs";

/**
 * Сайт обещает только то, что делает код (проход честности, 21.10.2026).
 *
 * ── Что было на странице и чего в коде нет ──────────────────────────────────
 *
 *   · «Оплата: Payme, Click или по счёту» на лендинге и «Click, Payme, Uzum
 *     Pay… оператор свяжется в течение 30 минут» в разделе оплаты — ни одной
 *     онлайн-оплаты в программе нет, оплата идёт заявкой
 *     (billing.requestUpgrade), а срок ответа не держит ничто;
 *   · «Перезвоним… обычно в течение дня» — тот же срок без опоры;
 *   · «Экспорт в Excel и CSV» — отчёты выгружаются в Excel; CSV есть только
 *     у журнала действий;
 *   · «след маршрута за день, неделю, месяц» — экран слежения берёт день;
 *   · «iOS и Android» — приложение для iPhone ещё на проверке App Store;
 *   · «Шесть ролей — …склад…» — роли «склад» нет, есть мерчендайзер;
 *   · FAQ: «двусторонний обмен остатками и контрагентами с 1С» — из 1С
 *     приходят товары и цены, в 1С уходят доставленные заказы и оплаты;
 *     «все действия пишутся в журнал» — пишутся ключевые денежные и
 *     складские правки;
 *   · README: демо-агент agent-tashkent — в засеве agent-urgench.
 *
 * Второй проход (ревью, 21.10.2026) — то же на остальных страницах:
 *
 *   · /pitch (в поиске, со своим canonical): «Приложение для iOS и
 *     Android», «iOS, Android и веб», «Веб, PWA, iOS и Android» — а на той
 *     же странице сказано, что iOS-приложение на проверке App Store;
 *   · лендинг: «Товары, заказы, контрагенты — двусторонняя синхронизация»,
 *     «Двусторонний обмен с 1С» (и в списке тарифа), «1С в обе стороны» —
 *     товары и цены только приходят из 1С, заказы и оплаты только уходят в
 *     неё, контрагенты сопоставляются с магазинами.
 *
 * Третий проход (после слияния складской, закупочной и доставочной веток,
 * 21.10.2026) — описание догнало код, и стражи держат то, что легко
 * разъехаться:
 *
 *   · перемещение в два шага («в пути») и утверждение инвентаризации
 *     директором включаются по желанию — по умолчанию их нет. Фраза без
 *     «по желанию» обещает покупателю порядок, которого он после
 *     регистрации не увидит;
 *   · числа в тексте — из кода: «до 20 дополнительных» штрих-кодов
 *     (MAX_EXTRA_BARCODES), «одиннадцать галочек» прав оператора
 *     (OPERATOR_CAPABILITIES; было «десять» — галочка перемещений добавилась);
 *   · руководство больше не говорит «Продажа при этом всегда идёт с
 *     основного склада» (есть точки продаж) и «Заказ поставщику оформляется
 *     приходом» (есть заказы поставщикам с согласованием).
 *
 * Сравнение, конкурс и статьи проверяются по исходному тексту: их страницы
 * тянут сеть и демо, а обещание живёт в строке, где бы её ни показали.
 *
 * Нарочная поломка: вернуть любую из строк выше — падает соответствующая
 * проверка.
 */
vi.setConfig({ testTimeout: 30_000 });

vi.mock("@/lib/public-api", () => ({ createLead: () => new Promise(() => {}) }));

const { default: Landing } = await import("@/pages/Landing");
const { LangProvider } = await import("@/i18n");
const { PaymentMethodsCard } = await import("@/components/billing/PaymentMethodsCard");
const { FAQ_ITEMS } = await import("@/components/landing/site-content");
const { MAX_EXTRA_BARCODES } = await import("@contracts/product-barcodes");
const { OPERATOR_CAPABILITIES } = await import("@contracts/constants");

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: false, media: q, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
  vi.stubGlobal("IntersectionObserver", class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
    root = null; rootMargin = ""; thresholds = [];
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** Весь текст лендинга на языке lang, включая свёрнутые ответы FAQ. */
function landingText(lang: "ru" | "uz"): string {
  localStorage.setItem("lang", lang);
  render(<MemoryRouter><LangProvider><Landing /></LangProvider></MemoryRouter>);
  const faq = FAQ_ITEMS.map(x => `${x.q[lang]} ${x.a[lang]}`).join(" ");
  return `${document.body.textContent ?? ""} ${faq}`;
}

describe("лендинг не обещает того, чего нет в коде", () => {
  it("по-русски", () => {
    const text = landingText("ru");
    expect(text).not.toMatch(/Payme|Click|Uzum/);
    expect(text).not.toMatch(/в течение (дня|часа|\d+ минут)/i);
    expect(text).not.toMatch(/Excel и CSV/);
    expect(text).not.toMatch(/неделю, месяц/);
    expect(text).not.toMatch(/iOS и Android/);
    expect(text).not.toMatch(/оператор, склад, агент/);
    expect(text).not.toMatch(/все действия пишутся/);
    expect(text).not.toMatch(/остатки и контрагенты синхронизируются/);
    expect(text).not.toMatch(/двусторонн|в обе стороны/i);
    // А что есть — сказано как есть.
    expect(text).toMatch(/Онлайн-оплаты на сайте пока нет/);
    expect(text).toMatch(/мерчендайзер/);
  });

  it("по-узбекски — те же поправки", () => {
    const text = landingText("uz");
    expect(text).not.toMatch(/Payme|Click|Uzum/);
    expect(text).not.toMatch(/kun davomida/);
    expect(text).not.toMatch(/Excel va CSV/);
    expect(text).not.toMatch(/hafta, oy/);
    expect(text).not.toMatch(/iOS va Android/);
    expect(text).not.toMatch(/barcha amallar jurnalga/);
    expect(text).not.toMatch(/ikki tomonlama/i);
    expect(text).toMatch(/onlayn to'lov hozircha yo'q/);
  });
});

describe("конкурс, сравнение и статьи не обещают того, чего нет в коде", () => {
  /** Исходный текст страниц, которые видит покупатель или жюри. */
  const sources = () => {
    const files = [
      ...readdirSync("src/components/pitch").map(f => `src/components/pitch/${f}`),
      ...readdirSync("src/site/articles/texts").map(f => `src/site/articles/texts/${f}`),
      "src/pages/Pitch.tsx", "src/pages/PitchDemo.tsx", "src/pages/Compare.tsx",
    ].filter(f => /\.tsx?$/.test(f));
    // Комментарии — не обещание: правило «не писать iOS и Android» само их называет.
    return files.map(f => [f, readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")] as const);
  };

  it("iOS-приложение не названо готовым: оно на проверке App Store", () => {
    for (const [f, text] of sources()) {
      expect(text, f).not.toMatch(/iOS (и|va) Android|iOS, Android|PWA, iOS/);
    }
  });

  it("обмен с 1С не назван двусторонней синхронизацией всего", () => {
    for (const [f, text] of sources()) {
      expect(text, f).not.toMatch(/двусторонн|в обе стороны|ikki tomonlama/i);
    }
  });
});

describe("раздел оплаты в программе", () => {
  it("без Click/Payme/Uzum и без «30 минут»: оплата — заявкой", () => {
    const t = (ru: string) => ru;
    render(<PaymentMethodsCard t={t} />);
    const card = screen.getByText(/Как оплатить/).closest("div")!.parentElement!.textContent ?? "";
    expect(card).not.toMatch(/Click|Payme|Uzum|30 минут/);
    expect(card).toMatch(/Онлайн-оплаты в программе пока нет/);
    expect(card).toMatch(/Подключить/);
  });
});

describe("README", () => {
  it("демо-агент — тот, что в засеве", () => {
    const readme = readFileSync("README.md", "utf8");
    const seed = readFileSync("db/seed.ts", "utf8");
    const agent = /`(agent-[a-z]+@demo-uz\.uz)`/.exec(readme)?.[1];
    expect(agent, "в README нет демо-агента").toBeTruthy();
    expect(seed).toContain(agent!);
  });
});

describe("после слияния: склад, закупки и доставка — как в коде", () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  /** Всё, что описывает продукт покупателю: лендинг, сравнение, конкурс, README. */
  const surfaces = () => [
    ...readdirSync("src/components/landing").filter(f => /\.tsx?$/.test(f)).map(f => `src/components/landing/${f}`),
    "src/components/compare/compare-content.ts", "src/components/pitch/pitch-content.ts", "README.md",
  ].map(f => [f, strip(readFileSync(f, "utf8"))] as const);
  /** Кусок фразы: до точки, точки с запятой, кавычки строки или конца строки. */
  const clauses = (text: string) => text.split(/[.;\n"`]/);

  it("«в два шага» и утверждение инвентаризации названы включаемыми по желанию", () => {
    let ru = 0, uz = 0;
    for (const [f, text] of surfaces()) {
      for (const c of clauses(text)) {
        if (/в два шага|«в пути»|утвержден\S* директора|с его утверждением/.test(c)) {
          ru++;
          expect(c, f).toMatch(/по желанию|по настройке|по выбору|можно включить/);
        }
        if (/ikki bosqich|direktor tasdig'i/.test(c)) {
          uz++;
          expect(c, f).toMatch(/xohishga ko'ra/);
        }
      }
    }
    // Страж не пустой: фразы есть, и каждая проверена.
    expect(ru).toBeGreaterThanOrEqual(4);
    expect(uz).toBeGreaterThanOrEqual(3);
  });

  it("числа берутся из кода: дополнительные штрих-коды и галочки прав оператора", () => {
    const warehouse = readFileSync("src/components/landing/WarehouseSection.tsx", "utf8");
    expect(warehouse).toContain(`до ${MAX_EXTRA_BARCODES} дополнительных`);
    expect(warehouse).toContain(`${MAX_EXTRA_BARCODES} tagacha qo'shimcha`);

    const words: Record<number, [string, string]> = {
      10: ["десять", "o'nta"], 11: ["одиннадцать", "o'n bitta"], 12: ["двенадцать", "o'n ikkita"],
    };
    const [ru, uz] = words[OPERATOR_CAPABILITIES.length] ?? ["?", "?"];
    const manual = readFileSync("scripts/manual_content.py", "utf8");
    const ruSaid = [...manual.matchAll(/«Права оператора»: (\S+) галочек/g)].map(m => m[1]);
    const uzSaid = [...manual.matchAll(/«Operator huquqlari»: ([a-z' ]+?) belgi\b/g)].map(m => m[1]);
    expect(ruSaid.length, "руководство перестало называть число галочек — страж ничего не держит").toBeGreaterThan(0);
    expect(uzSaid.length).toBe(ruSaid.length);
    for (const w of ruSaid) expect(w).toBe(ru);
    for (const w of uzSaid) expect(w).toBe(uz);
  });

  it("руководство не повторяет того, что слияние сделало неправдой", () => {
    const manual = readFileSync("scripts/manual_content.py", "utf8");
    expect(manual).not.toMatch(/всегда идёт с основного склада|doim asosiy ombordan/);
    expect(manual).not.toMatch(/Заказ поставщику оформляется приходом|buyurtma tovar kelganda kirim bilan rasmiylashtiriladi/);
  });
});
