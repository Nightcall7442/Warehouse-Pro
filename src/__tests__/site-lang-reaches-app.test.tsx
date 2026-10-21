// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import type { ReactElement } from "react";

/**
 * Язык страницы сайта доходит до регистрации и входа.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * /uz открывается по-узбекски из адреса, а заход по ссылке выбором не
 * считается — «lang» не сохраняется. Но «Bepul boshlang» вёл на голый
 * /register, а «Kirish» — на /login: приложение берёт язык только из
 * сохранённого выбора, и узбекоязычный посетитель, ни разу не нажимавший
 * переключатель, получал русскую форму, русские ошибки сервера и русское
 * приложение после регистрации. Проверено в Chromium на собранном сервере.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   · с /uz, /uz/compare ссылки «Начать» и «Войти» несут ?lang=uz (вместе с
 *     метками рекламы); с русских страниц — как раньше, без ?lang;
 *   · /register?lang=uz и /login?lang=uz — по-узбекски, x-lang — uz; заход
 *     выбор не сохраняет;
 *   · доведённые до конца регистрация и вход сохраняют язык адреса, если
 *     выбора в этом браузере ещё не было; сделанный раньше выбор — сильнее.
 *
 * Нарочная поломка: убрать appPath у «Начать» в шапке лендинга — падает
 * «ссылки с /uz»; убрать QueryLang у /register в тесте и в App.tsx —
 * «регистрация по-узбекски»; убрать keepUrlLang() из onSuccess — «после
 * регистрации язык сохранён».
 */
vi.setConfig({ testTimeout: 30_000 });

const registerMutate = vi.fn();
const register = { ok: false };
vi.mock("@/lib/public-api", () => ({ createLead: () => new Promise(() => {}) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null, isLoading: false }) }));
vi.mock("@/providers/trpc", () => ({
  trpc: {
    tenant: {
      register: {
        useMutation: (o?: { onSuccess?: () => void }) => ({
          mutate: (input: unknown) => { registerMutate(input); if (register.ok) o?.onSuccess?.(); },
          isPending: false, isSuccess: false, error: null,
        }),
      },
    },
    auth: { resendVerification: { useMutation: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isSuccess: false }) } },
    // Знак на экране входа (useAppBrand): до входа бренда нет.
    branding: { get: { useQuery: () => ({ data: undefined }) } },
  },
}));

const { default: Landing } = await import("@/pages/Landing");
const { default: Compare } = await import("@/pages/Compare");
const { default: Register } = await import("@/pages/Register");
const { default: Login } = await import("@/pages/Login");
const { default: SitePageLang } = await import("@/components/landing/SitePageLang");
const { default: QueryLang } = await import("@/components/QueryLang");
const { LangProvider } = await import("@/i18n");
const { appPath } = await import("@/lib/site-paths");
const { uiLang } = await import("@/lib/ui-text");

const replace = vi.fn();
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  registerMutate.mockClear();
  replace.mockClear();
  register.ok = false;
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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); document.documentElement.lang = ""; });

/** Маршруты как в App.tsx: страницы сайта в SitePageLang, вход и регистрация — в QueryLang. */
const at = (url: string, page: ReactElement) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <LangProvider>
        <Routes>
          <Route path="/" element={<SitePageLang page="home">{page}</SitePageLang>} />
          <Route path="/uz" element={<SitePageLang page="home">{page}</SitePageLang>} />
          <Route path="/uz/compare" element={<SitePageLang page="compare">{page}</SitePageLang>} />
          <Route path="/register" element={<QueryLang>{page}</QueryLang>} />
          <Route path="/login" element={<QueryLang>{page}</QueryLang>} />
        </Routes>
      </LangProvider>
    </MemoryRouter>,
  );

describe("ссылки сайта в приложение несут язык страницы", () => {
  it("appPath: узбекский — ?lang=uz рядом с метками и якорем, русский — как есть", () => {
    expect(appPath("uz", "/register")).toBe("/register?lang=uz");
    expect(appPath("uz", "/register?utm_source=ig#x")).toBe("/register?utm_source=ig&lang=uz#x");
    expect(appPath("ru", "/login")).toBe("/login");
  });

  it("с /uz «Начать» и «Войти» — с ?lang=uz и метками рекламы", () => {
    at("/uz?utm_source=tg", <Landing />);
    const want = "/register?lang=uz&utm_source=tg";
    const hero = document.querySelector("[data-first-screen]") as HTMLElement;
    const heroStart = within(hero).getByRole("link", { name: /Bepul boshlash/ });
    for (const a of [heroStart, screen.getByTestId("header-register"), screen.getByTestId("menu-register"), screen.getByTestId("pricing-start"), screen.getByTestId("mobile-cta-register")]) {
      expect(a.getAttribute("href"), a.textContent ?? "").toBe(want);
    }
    const all = Array.from(document.querySelectorAll("a")).filter(a => (a.getAttribute("href") ?? "").startsWith("/register"));
    for (const a of all) expect(a.getAttribute("href")).toBe(want);
    const logins = Array.from(document.querySelectorAll("a")).filter(a => (a.getAttribute("href") ?? "").startsWith("/login"));
    expect(logins.length).toBeGreaterThanOrEqual(2);
    for (const a of logins) expect(a.getAttribute("href")).toBe("/login?lang=uz");
  });

  it("с русской «/» — как раньше, без ?lang: выбравший узбекский получит свой выбор", () => {
    at("/?utm_source=tg", <Landing />);
    expect(screen.getByTestId("header-register").getAttribute("href")).toBe("/register?utm_source=tg");
    for (const a of Array.from(document.querySelectorAll("a")).filter(a => (a.getAttribute("href") ?? "").startsWith("/login"))) {
      expect(a.getAttribute("href")).toBe("/login");
    }
  });

  it("с /uz/compare — то же: «Попробовать», «Начать» и «Войти» в шапке", () => {
    at("/uz/compare", <Compare />);
    expect(screen.getByTestId("compare-cta-register").getAttribute("href")).toBe("/register?lang=uz");
    expect(screen.getByTestId("pitch-header-register").getAttribute("href")).toBe("/register?lang=uz");
    const logins = Array.from(document.querySelectorAll("a")).filter(a => (a.getAttribute("href") ?? "").startsWith("/login"));
    expect(logins.length).toBeGreaterThan(0);
    for (const a of logins) expect(a.getAttribute("href")).toBe("/login?lang=uz");
  });
});

describe("регистрация и вход на языке ссылки", () => {
  it("App.tsx читает ?lang у /register и /login (QueryLang)", async () => {
    const { readFileSync } = await import("node:fs");
    const app = readFileSync("src/App.tsx", "utf8");
    expect(app).toMatch(/<Route path="\/register"\s+element=\{<QueryLang><Register \/><\/QueryLang>\}/);
    expect(app).toMatch(/<Route path="\/login"\s+element=\{<QueryLang><Login \/><\/QueryLang>\}/);
  });

  const fill = () => {
    fireEvent.change(screen.getByTestId("register-name"), { target: { value: "Dilnoza" } });
    fireEvent.change(screen.getByTestId("register-companyName"), { target: { value: "Sok" } });
    fireEvent.change(screen.getByTestId("register-email"), { target: { value: "d@sok.uz" } });
    fireEvent.change(screen.getByTestId("register-phone"), { target: { value: "901234567" } });
    fireEvent.change(screen.getByTestId("register-password"), { target: { value: "parol-sakkiz" } });
    fireEvent.submit(screen.getByTestId("register-submit").closest("form")!);
  };

  it("/register?lang=uz — форма по-узбекски, x-lang — uz; заход выбор не сохраняет", () => {
    at("/register?lang=uz", <Register />);
    expect(screen.getByText("2 daqiqada hisob yarating")).toBeTruthy();
    expect(uiLang()).toBe("uz");
    expect(localStorage.getItem("lang")).toBeNull();
    // «Войти» на форме — тоже по-узбекски.
    expect(screen.getByRole("link", { name: "Kirish" }).getAttribute("href")).toBe("/login?lang=uz");
  });

  it("после регистрации язык адреса сохранён — письмо, вход и приложение дальше по-узбекски", () => {
    register.ok = true;
    at("/register?lang=uz", <Register />);
    fill();
    expect(registerMutate).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("lang")).toBe("uz");
  });

  it("сделанный раньше выбор сильнее: регистрация с ?lang=uz его не перезаписывает", () => {
    localStorage.setItem("lang", "ru");
    register.ok = true;
    at("/register?lang=uz", <Register />);
    expect(screen.getByText("2 daqiqada hisob yarating")).toBeTruthy();
    fill();
    expect(localStorage.getItem("lang")).toBe("ru");
  });

  it("/login?lang=uz — вход по-узбекски; удачный вход сохраняет язык до перезагрузки", async () => {
    Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, replace, search: "?lang=uz" } });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })));
    at("/login?lang=uz", <Login />);
    expect(screen.getByText("Xush kelibsiz")).toBeTruthy();
    expect(localStorage.getItem("lang")).toBeNull();
    fireEvent.change(screen.getByTestId("login-email"), { target: { value: "d@sok.uz" } });
    fireEvent.change(screen.getByTestId("login-password"), { target: { value: "parol" } });
    fireEvent.click(screen.getByTestId("login-submit"));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(localStorage.getItem("lang")).toBe("uz");
  });
});
