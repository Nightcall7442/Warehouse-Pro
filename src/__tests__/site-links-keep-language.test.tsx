// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import type { ReactElement } from "react";

/**
 * Ссылки на страницы сайта — на языке, который человек видит.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Подвал лендинга вёл «Taqqoslash» с /uz на русский /compare — с
 * перезагрузкой, по-русски; на /uz/compare не вела ни одна ссылка. Подвал
 * конкурса брал язык ссылок из адреса, а на /pitch его нет: выбравший на
 * месте узбекский уходил по «Sayt» на русскую главную.
 *
 * Нарочная поломка: вернуть в подвал лендинга href: "/compare" — падает
 * «подвал /uz»; брать siteLang в PitchFooter из адреса — «/pitch».
 */
vi.setConfig({ testTimeout: 30_000 });

vi.mock("@/lib/public-api", () => ({ createLead: () => new Promise(() => {}) }));
const { default: Landing } = await import("@/pages/Landing");
const { default: SitePageLang } = await import("@/components/landing/SitePageLang");
const { LangProvider } = await import("@/i18n");

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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); document.documentElement.lang = ""; });

/** Маршруты как в App.tsx: страницы сайта в SitePageLang. */
const at = (url: string, page: ReactElement) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <LangProvider>
        <Routes>
          <Route path="/" element={<SitePageLang page="home">{page}</SitePageLang>} />
          <Route path="/uz" element={<SitePageLang page="home">{page}</SitePageLang>} />
          <Route path="/uz/compare" element={<SitePageLang page="compare">{page}</SitePageLang>} />
        </Routes>
      </LangProvider>
    </MemoryRouter>,
  );

describe("ссылки на страницы сайта — на языке, который человек видит", () => {
  it("подвал /uz: «Taqqoslash» — на /uz/compare, а не на русский /compare", () => {
    at("/uz", <Landing />);
    expect(screen.getByRole("link", { name: "Taqqoslash" }).getAttribute("href")).toBe("/uz/compare");
    cleanup();
    at("/", <Landing />);
    expect(screen.getByRole("link", { name: "Сравнение" }).getAttribute("href")).toBe("/compare");
  });

  it("/pitch: «Sayt» ведёт на сайт на языке страницы — и после «Ру»", async () => {
    const { PitchShell } = await import("@/components/pitch/pitch-ui");
    render(
      <MemoryRouter initialEntries={["/pitch"]}>
        <LangProvider><PitchShell title={{ ru: "Проект", uz: "Loyiha" }}><p>matn</p></PitchShell></LangProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Sayt" }).getAttribute("href")).toBe("/uz");
    fireEvent.click(screen.getByTestId("pitch-lang-ru"));
    expect(screen.getByRole("link", { name: "Сайт" }).getAttribute("href")).toBe("/");
  });
});
