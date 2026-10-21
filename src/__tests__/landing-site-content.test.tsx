// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { ReactElement } from "react";
import { FIELD_PRICE_UZS, MIN_FIELD_USERS, formatSum } from "@contracts/pricing";
import type { L } from "@/components/pitch/pitch-content";

/**
 * Разделы лендинга, которые отвечают «про меня ли это» и «можно ли верить»:
 * для кого, кому не подойдём, обещания с проверкой, как начать.
 *
 *   · «Для кого» стоит на странице и говорит словами из site-content —
 *     одним источником, на двух языках;
 *   · минимум людей в поле — из contracts/pricing, а не цифрой в тексте;
 *   · «кому не подойдём» называет то, чего в программе нет: ТСД, 3PL,
 *     маркировку, кассу;
 *   · у каждого обещания есть «как проверить за 14 дней», и стоят обещания
 *     перед тарифами; сроков ответа поддержки и «гарантий» среди них нет —
 *     их не держит код;
 *   · «Как начать» — шаги со временем на каждый, одним списком с /compare;
 *     пилот для дистрибьюторов от 10 агентов с тремя мерилами и заявкой,
 *     помеченной «pilot».
 *
 * Нарочная поломка: убрать <AudienceSection /> из Landing — падает «стоит на
 * странице»; написать в AUDIENCE_FIT «3–50» буквами — «минимум из модуля
 * цен» (при смене MIN_FIELD_USERS текст разошёлся бы с тарифом); убрать у
 * обещания check — «у каждого обещания есть проверка»; вернуть сравнению
 * свой список шагов — «сравнение показывает те же шаги».
 */
vi.setConfig({ testTimeout: 30_000 });

const leadMutate = vi.fn();
vi.mock("@/providers/trpc", () => ({
  trpc: {
    lead: { create: { useMutation: () => ({ mutate: leadMutate, isPending: false, isSuccess: false, error: null }) } },
  },
}));

const { default: Landing } = await import("@/pages/Landing");
const { default: AudienceSection } = await import("@/components/landing/AudienceSection");
const { default: PromisesSection } = await import("@/components/landing/PromisesSection");
const { default: StartSection } = await import("@/components/landing/StartSection");
const { default: Compare } = await import("@/pages/Compare");
const { LangProvider } = await import("@/i18n");
const content = await import("@/components/landing/site-content");

beforeEach(() => {
  localStorage.clear();
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

const draw = (ui: ReactElement) => render(<MemoryRouter><LangProvider>{ui}</LangProvider></MemoryRouter>);

/** Все тексты site-content — пары ru/uz, ни одной пустой половины. */
function allPairs(): L[] {
  const out: L[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.ru === "string" && typeof o.uz === "string") { out.push(o as L); return; }
      Object.values(o).forEach(walk);
    }
  };
  Object.values(content).forEach(walk);
  return out;
}

describe("site-content: оба языка", () => {
  it("у каждого текста есть и русская, и узбекская половина", () => {
    const pairs = allPairs();
    expect(pairs.length).toBeGreaterThan(10);
    for (const p of pairs) {
      expect(p.ru.trim(), p.uz).not.toBe("");
      expect(p.uz.trim(), p.ru).not.toBe("");
    }
  });
});

describe("для кого", () => {
  it("стоит на странице сразу за первым экраном, до потерь", () => {
    draw(<Landing />);
    const audience = document.getElementById("audience");
    expect(audience, "раздела «Для кого» нет").toBeTruthy();
    const hero = document.querySelector("[data-first-screen]")!;
    const loss = document.getElementById("loss")!;
    expect(hero.compareDocumentPosition(audience!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(audience!.compareDocumentPosition(loss) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // В шапке — ссылка на раздел.
    expect(Array.from(document.querySelectorAll("a")).some(a => a.getAttribute("href") === "#audience")).toBe(true);
  });

  it("четыре признака «подойдём» и четыре «не подойдём» — из site-content", () => {
    draw(<AudienceSection />);
    const fit = screen.getAllByTestId("audience-fit");
    expect(fit).toHaveLength(content.AUDIENCE_FIT.length);
    expect(fit.map(li => li.textContent)).toEqual(
      content.AUDIENCE_FIT.map(a => expect.stringContaining(a.t.ru)),
    );
    const notFit = screen.getAllByTestId("audience-not-fit").map(li => li.textContent ?? "");
    expect(notFit).toHaveLength(content.AUDIENCE_NOT_FIT.length);
    for (const re of [/ТСД/, /3PL/, /Asl Belgisi/, /касс/i]) {
      expect(notFit.some(t => re.test(t)), `в «не подойдём» нет ${re}`).toBe(true);
    }
  });

  it("минимум людей в поле — из модуля цен", () => {
    draw(<AudienceSection />);
    const first = screen.getAllByTestId("audience-fit")[0];
    expect(within(first).getByText(`${MIN_FIELD_USERS}–50`)).toBeTruthy();
  });

  it("по-узбекски — узбекские слова", () => {
    localStorage.setItem("lang", "uz");
    draw(<AudienceSection />);
    expect(screen.getByTestId("landing-audience").textContent).toContain("Kim uchun");
    expect(screen.getByTestId("landing-audience").textContent).not.toMatch(/Для кого/);
  });
});

describe("обещания, которые можно проверить", () => {
  it("стоят перед тарифами", () => {
    draw(<Landing />);
    const promises = document.getElementById("promises");
    expect(promises, "раздела обещаний нет").toBeTruthy();
    const pricing = document.getElementById("pricing")!;
    expect(promises!.compareDocumentPosition(pricing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("у каждого обещания есть проверка — на странице и в site-content", () => {
    draw(<PromisesSection />);
    const items = screen.getAllByTestId("promise");
    expect(items).toHaveLength(content.PROMISES.length);
    expect(items.length).toBeGreaterThanOrEqual(4);
    for (const [i, li] of items.entries()) {
      const p = content.PROMISES[i];
      expect(p.check.ru.length, p.key).toBeGreaterThan(40);
      expect(within(li).getByTestId("promise-check").textContent).toContain(p.check.ru);
      expect(li.textContent).toContain("Как проверить за 14 дней");
    }
  });

  it("без сроков ответа, «гарантий» и процентов доступности — их не держит код", () => {
    draw(<PromisesSection />);
    const text = screen.getByTestId("landing-promises").textContent ?? "";
    expect(text).not.toMatch(/гарант|SLA|99[.,]\d|в течение (часа|\d+ минут)|ответим за/i);
  });
});

describe("как начать", () => {
  it("стоит сразу за тарифами, до FAQ; в шапке есть ссылка", () => {
    draw(<Landing />);
    const start = document.getElementById("start");
    expect(start, "раздела «Как начать» нет").toBeTruthy();
    const pricing = document.getElementById("pricing")!;
    const faq = document.getElementById("faq")!;
    expect(pricing.compareDocumentPosition(start!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(start!.compareDocumentPosition(faq) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(Array.from(document.querySelectorAll("a")).some(a => a.getAttribute("href") === "#start")).toBe(true);
  });

  it("у каждого шага — время, по порядку из site-content", () => {
    draw(<StartSection />);
    const steps = screen.getAllByTestId("start-step");
    expect(steps).toHaveLength(content.START_STEPS.length);
    expect(screen.getAllByTestId("start-step-time").map(n => n.textContent)).toEqual(content.START_STEPS.map(s => s.time.ru));
    for (const s of content.START_STEPS) expect(s.time.ru.trim(), s.t.ru).not.toBe("");
  });

  it("сравнение показывает те же шаги с тем же временем", () => {
    draw(<Compare />);
    expect(screen.getAllByTestId("compare-step")).toHaveLength(content.START_STEPS.length);
    expect(screen.getAllByTestId("compare-step-time").map(n => n.textContent)).toEqual(content.START_STEPS.map(s => s.time.ru));
  });

  it("пилот: от 10 агентов, одна команда на две недели внутри пробного, три мерила", () => {
    draw(<StartSection />);
    const pilot = screen.getByTestId("start-pilot");
    expect(content.PILOT_MIN_AGENTS).toBe(10);
    expect(pilot.textContent).toContain("от 10 агентов");
    expect(pilot.textContent).toMatch(/две недели/);
    expect(pilot.textContent).toMatch(/бесплатного периода/);
    const criteria = within(pilot).getAllByTestId("pilot-criterion").map(n => n.textContent ?? "");
    expect(criteria).toHaveLength(3);
    for (const re of [/Визиты/, /Долги/, /Наличные/]) expect(criteria.some(c => re.test(c)), String(re)).toBe(true);
  });

  it("заявка на пилот уходит с источником «pilot»", () => {
    leadMutate.mockClear();
    draw(<StartSection />);
    const pilot = screen.getByTestId("start-pilot");
    fireEvent.change(within(pilot).getByTestId("lead-name"), { target: { value: "Иван" } });
    fireEvent.change(within(pilot).getByTestId("lead-phone"), { target: { value: "+998 90 123 45 67" } });
    fireEvent.submit(within(pilot).getByTestId("lead-name").closest("form")!);
    expect(leadMutate).toHaveBeenCalledWith(expect.objectContaining({ source: "pilot" }));
  });

  it("цена в шаге «Решение» — из модуля цен", () => {
    const last = content.START_STEPS[content.START_STEPS.length - 1];
    expect(last.d.ru).toContain(formatSum(FIELD_PRICE_UZS));
  });
});
