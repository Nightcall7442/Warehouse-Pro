// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { useEffect, type ReactElement } from "react";

/**
 * Метки рекламы — от первого захода до регистрации и заявки (lib/attribution).
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Реклама ведёт на лендинг (/?utm_source=ig), а «Начать бесплатно» был
 * кнопкой navigate("/register") — на голый адрес, без меток. Регистрация
 * читала метки только из своего адреса, заявка «перезвоните» не несла их
 * вовсе. Откуда пришла хоть одна организация, не знал никто.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   · метки из адреса запоминаются на вкладку, первое касание не
 *     перезаписывается; мусор вычищается тем же правилом, что у сервера;
 *   · все «Начать» лендинга и сравнения — ссылки на /register с метками, в
 *     той же вкладке, и обычное нажатие — переход без перезагрузки;
 *   · регистрация без меток в адресе берёт запомненные и шлёт utm_medium и
 *     utm_campaign; заявка шлёт метки в attribution;
 *   · хранилище закрыто — всё работает без меток.
 *
 * Нарочная поломка: убрать captureAttribution из Landing — падает «ссылки
 * лендинга несут метки»; вернуть «Начать» кнопкой — тот же тест (нет href);
 * перезаписывать метки при каждом заходе — «первое касание»; убрать
 * readAttribution из Register — «регистрация без меток в адресе».
 */
vi.setConfig({ testTimeout: 30_000 });

const leadMutate = vi.fn();
const registerMutate = vi.fn();
vi.mock("@/providers/trpc", () => ({
  trpc: {
    lead: { create: { useMutation: () => ({ mutate: leadMutate, isPending: false, isSuccess: false, error: null }) } },
    tenant: { register: { useMutation: () => ({ mutate: registerMutate, isPending: false, isSuccess: false, error: null }) } },
    auth: { resendVerification: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) } },
  },
}));

const { attributionFromSearch, captureAttribution, readAttribution, withAttribution } = await import("@/lib/attribution");
const { default: Landing } = await import("@/pages/Landing");
const { default: Compare } = await import("@/pages/Compare");
const { default: Register } = await import("@/pages/Register");
const { default: LeadForm } = await import("@/components/landing/LeadForm");
const { LangProvider } = await import("@/i18n");

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  leadMutate.mockClear();
  registerMutate.mockClear();
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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** Где сейчас роутер: пишется из эффекта, а не при отрисовке. */
const loc = { at: "" };
function Where() {
  const l = useLocation();
  useEffect(() => { loc.at = l.pathname + l.search; }, [l]);
  return null;
}
const at = (url: string, ui: ReactElement) =>
  render(<MemoryRouter initialEntries={[url]}><LangProvider>{ui}<Where /></LangProvider></MemoryRouter>);

describe("метки: запомнить и отдать", () => {
  it("из адреса — четыре метки, вычищенные; ни одной — null", () => {
    expect(attributionFromSearch("?utm_source=ig<script>&utm_medium=cpc&utm_campaign=okt 2026&ref=bekzod&x=1"))
      .toEqual({ utmSource: "igscript", utmMedium: "cpc", utmCampaign: "okt2026", ref: "bekzod" });
    expect(attributionFromSearch("?lang=ru")).toBeNull();
    expect(attributionFromSearch("")).toBeNull();
  });

  it("первое касание: второй заход с другой рекламой метки не перезаписывает", () => {
    expect(captureAttribution("?utm_source=ig&utm_campaign=okt")).toEqual({ utmSource: "ig", utmCampaign: "okt" });
    expect(captureAttribution("?utm_source=fb")).toEqual({ utmSource: "ig", utmCampaign: "okt" });
    expect(readAttribution()).toEqual({ utmSource: "ig", utmCampaign: "okt" });
  });

  it("адрес со своими метками: добавляются недостающие, свои и якорь остаются", () => {
    expect(withAttribution("/register")).toBe("/register");
    captureAttribution("?utm_source=ig&ref=bekzod");
    expect(withAttribution("/register")).toBe("/register?utm_source=ig&ref=bekzod");
    expect(withAttribution("/register?utm_source=tg#x")).toBe("/register?utm_source=tg&ref=bekzod#x");
  });

  it("хранилище закрыто — без меток и без падения", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(captureAttribution("?utm_source=ig")).toEqual({ utmSource: "ig" });
    expect(readAttribution()).toEqual({});
    expect(withAttribution("/register")).toBe("/register");
  });

  it("испорченная запись в хранилище — пусто, а не мусор в адресе", () => {
    sessionStorage.setItem("wp-attribution", "{не json");
    expect(readAttribution()).toEqual({});
    sessionStorage.setItem("wp-attribution", JSON.stringify({ utmSource: "a b<c>", ref: 5 }));
    expect(readAttribution()).toEqual({ utmSource: "abc" });
  });
});

describe("лендинг: «Начать» — ссылки с метками", () => {
  it("ссылки лендинга несут метки, в той же вкладке", () => {
    at("/?utm_source=ig&utm_campaign=okt", <Landing />);
    const want = "/register?utm_source=ig&utm_campaign=okt";
    const hero = document.querySelector("[data-first-screen]") as HTMLElement;
    const heroStart = within(hero).getByRole("link", { name: /Начать бесплатно/ });
    for (const a of [heroStart, screen.getByTestId("header-register"), screen.getByTestId("menu-register"), screen.getByTestId("pricing-start"), screen.getByTestId("mobile-cta-register")]) {
      expect(a.tagName, a.textContent ?? "").toBe("A");
      expect(a.getAttribute("href"), a.textContent ?? "").toBe(want);
      expect(a.hasAttribute("target"), "своя страница открылась бы в новой вкладке без меток").toBe(false);
    }
    const all = Array.from(document.querySelectorAll("a")).filter(a => (a.getAttribute("href") ?? "").startsWith("/register"));
    expect(all.length).toBeGreaterThanOrEqual(6);
    for (const a of all) expect(a.getAttribute("href")).toBe(want);
  });

  it("без рекламы — голый /register", () => {
    at("/", <Landing />);
    expect(screen.getByTestId("pricing-start").getAttribute("href")).toBe("/register");
  });

  it("обычное нажатие — переход внутри приложения, а не перезагрузка", () => {
    at("/?utm_source=ig", <Landing />);
    // fireEvent возвращает false, когда переход браузера отменён.
    const browserWouldGo = fireEvent.click(screen.getByTestId("pricing-start"), { button: 0 });
    expect(browserWouldGo, "браузер перезагрузил бы приложение").toBe(false);
    expect(loc.at).toBe("/register?utm_source=ig");
  });

  it("с Ctrl — как у браузера (новая вкладка), роутер не вмешивается", () => {
    at("/", <Landing />);
    const browserWouldGo = fireEvent.click(screen.getByTestId("header-register"), { button: 0, ctrlKey: true });
    expect(browserWouldGo).toBe(true);
    expect(loc.at).toBe("/");
  });
});

describe("сравнение: метки и там", () => {
  it("«Попробовать» и «Начать» в шапке несут метки захода на /compare", () => {
    at("/compare?utm_source=tg&ref=sardor", <Compare />);
    expect(screen.getByTestId("compare-cta-register").getAttribute("href")).toBe("/register?utm_source=tg&ref=sardor");
    expect(screen.getByTestId("pitch-header-register").getAttribute("href")).toBe("/register?utm_source=tg&ref=sardor");
  });
});

describe("регистрация и заявка", () => {
  const fill = () => {
    fireEvent.change(screen.getByTestId("register-name"), { target: { value: "Дилноза" } });
    fireEvent.change(screen.getByTestId("register-companyName"), { target: { value: "Сок" } });
    fireEvent.change(screen.getByTestId("register-email"), { target: { value: "d@sok.uz" } });
    fireEvent.change(screen.getByTestId("register-phone"), { target: { value: "901234567" } });
    fireEvent.change(screen.getByTestId("register-password"), { target: { value: "пароль-восемь" } });
    fireEvent.submit(screen.getByTestId("register-submit").closest("form")!);
  };

  it("регистрация без меток в адресе берёт запомненные — с каналом и кампанией", () => {
    captureAttribution("?utm_source=ig&utm_medium=cpc&utm_campaign=okt");
    window.history.replaceState(null, "", "/register");
    at("/register", <Register />);
    fill();
    expect(registerMutate).toHaveBeenCalledWith(expect.objectContaining({
      source: { answer: undefined, utmSource: "ig", utmMedium: "cpc", utmCampaign: "okt" },
    }));
  });

  it("метки в адресе регистрации сильнее запомненных", () => {
    captureAttribution("?utm_source=ig");
    window.history.replaceState(null, "", "/register?utm_source=tg&utm_campaign=nov");
    at("/register?utm_source=tg&utm_campaign=nov", <Register />);
    fill();
    expect(registerMutate).toHaveBeenCalledWith(expect.objectContaining({
      source: { answer: undefined, utmSource: "tg", utmCampaign: "nov" },
    }));
    window.history.replaceState(null, "", "/");
  });

  it("без меток — source не уходит вовсе", () => {
    window.history.replaceState(null, "", "/register");
    at("/register", <Register />);
    fill();
    expect(registerMutate.mock.calls[0][0].source).toBeUndefined();
    window.history.replaceState(null, "", "/");
  });

  it("заявка несёт метки в attribution; без меток — не несёт", () => {
    at("/", <LeadForm source="hero" />);
    const send = () => {
      fireEvent.change(screen.getByTestId("lead-name"), { target: { value: "Иван" } });
      fireEvent.change(screen.getByTestId("lead-phone"), { target: { value: "+998 90 123 45 67" } });
      fireEvent.submit(screen.getByTestId("lead-name").closest("form")!);
    };
    send();
    expect(leadMutate.mock.calls[0][0].attribution).toBeUndefined();
    cleanup();
    captureAttribution("?utm_source=ig&ref=bekzod");
    at("/", <LeadForm source="hero" />);
    send();
    expect(leadMutate.mock.calls[1][0]).toEqual(expect.objectContaining({ source: "hero", attribution: { utmSource: "ig", ref: "bekzod" } }));
  });
});
