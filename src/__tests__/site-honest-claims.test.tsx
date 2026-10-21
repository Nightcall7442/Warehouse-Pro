// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { readFileSync } from "node:fs";

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
 * Нарочная поломка: вернуть любую из строк выше — падает соответствующая
 * проверка.
 */
vi.setConfig({ testTimeout: 30_000 });

vi.mock("@/lib/public-api", () => ({ createLead: () => new Promise(() => {}) }));

const { default: Landing } = await import("@/pages/Landing");
const { LangProvider } = await import("@/i18n");
const { PaymentMethodsCard } = await import("@/components/billing/PaymentMethodsCard");
const { FAQ_ITEMS } = await import("@/components/landing/site-content");

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
    expect(text).toMatch(/onlayn to'lov hozircha yo'q/);
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
