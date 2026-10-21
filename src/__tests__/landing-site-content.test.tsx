// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { ReactElement } from "react";
import { MIN_FIELD_USERS } from "@contracts/pricing";
import type { L } from "@/components/pitch/pitch-content";

/**
 * Разделы лендинга, которые отвечают «про меня ли это»: для кого, кому не
 * подойдём (дальше — обещания и как начать).
 *
 *   · «Для кого» стоит на странице и говорит словами из site-content —
 *     одним источником, на двух языках;
 *   · минимум людей в поле — из contracts/pricing, а не цифрой в тексте;
 *   · «кому не подойдём» называет то, чего в программе нет: ТСД, 3PL,
 *     маркировку, кассу.
 *
 * Нарочная поломка: убрать <AudienceSection /> из Landing — падает «стоит на
 * странице»; написать в AUDIENCE_FIT «3–50» буквами — «минимум из модуля
 * цен» (при смене MIN_FIELD_USERS текст разошёлся бы с тарифом).
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
