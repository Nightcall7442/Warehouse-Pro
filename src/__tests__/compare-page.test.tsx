// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { readFileSync } from "node:fs";

/**
 * Страница сравнения /compare — Warehouse Pro, Sales Doctor, Smartup.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * 1. Адрес публичный: среди открытых маршрутов до оболочки приложения, в
 *    карте сайта, ссылка в подвале лендинга.
 * 2. Разделы, которые назвал владелец, — все на месте: погрузочные листы,
 *    редактор заказа, частичная доставка, акт сверки, товары и магазины,
 *    склад, отчёты. У каждой строки — наш ответ и ответ про обоих.
 * 3. Главное правило страницы. О других — только «заявлено» со ссылкой на
 *    источник с датой, или «уточняйте у компании»; ни одного «у них нет».
 *    Каждый источник, на который ссылается ячейка, есть на странице с якорем
 *    — ссылка «[spot.uz]» не ведёт в пустоту.
 * 4. Чего нет у нас — сказано в нашей же колонке и в разделе «Чего нет».
 * 5. Цена — из модуля цен, а не числом в тексте.
 * 6. Язык: русский по умолчанию (страница сайта для дистрибьютора, как
 *    лендинг), выбор не записывается сам; переключатель на узбекский работает,
 *    тексты обоих языков не пустые.
 */

vi.setConfig({ testTimeout: 20_000 });

import Compare from "@/pages/Compare";
import { LangProvider } from "@/i18n";
import { AREAS, QUESTIONS, PLAYERS, STEPS, SOURCES, CHECKED_AT } from "@/components/compare/compare-content";
import { GAPS, type L } from "@/components/pitch/pitch-content";
import { FIELD_PRICE_UZS, MIN_FIELD_USERS, formatSum } from "@contracts/pricing";

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: false, media: q, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const draw = () => render(<MemoryRouter><LangProvider><Compare /></LangProvider></MemoryRouter>);

describe("адрес публичный", () => {
  it("/compare — среди открытых маршрутов, до оболочки приложения", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const at = app.indexOf('<Route path="/compare"');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(app.indexOf("<Route element={<AppLayout />}>"));
    expect(app.slice(at, app.indexOf("\n", at))).not.toMatch(/RoleGuard|AppLayout|Navigate/);
  });

  it("карта сайта знает адрес, подвал лендинга ведёт на него", () => {
    expect(readFileSync("public/sitemap.xml", "utf8")).toContain("https://www.warehouse-pro.uz/compare</loc>");
    expect(readFileSync("src/pages/Landing.tsx", "utf8")).toMatch(/href: "\/compare"/);
  });
});

describe("раздел за разделом", () => {
  it("разделы, которые назвал владелец, — все на месте", () => {
    draw();
    const names = screen.getAllByTestId("compare-area").map(r => within(r).getByRole("rowheader").textContent);
    for (const want of ["Погрузочные листы", "Редактор заказа", "частично доставлен", "Акт сверки", "Товары и магазины", "Склад", "Отчёты"]) {
      expect(names.some(n => n!.includes(want)), want).toBe(true);
    }
    expect(names).toHaveLength(AREAS.length);
    expect(new Set(names).size, "разделы повторяются").toBe(names.length);
  });

  it("в каждой строке — наш ответ и по ячейке на Sales Doctor и Smartup, как в содержании", () => {
    draw();
    const rows = screen.getAllByTestId("compare-area");
    rows.forEach((row, i) => {
      const a = AREAS[i];
      expect(within(row).getByTestId("compare-ours").textContent).toContain(a.ours.ru);
      const claims = within(row).getAllByTestId("compare-claim");
      expect(claims).toHaveLength(2);
      [a.salesDoctor, a.smartup].forEach((c, j) => {
        expect(claims[j].getAttribute("data-claimed"), `${a.area.ru} #${j}`).toBe(c ? "yes" : "no");
        expect(claims[j].textContent).toContain(c ? c.text.ru : "Уточняйте у компании");
      });
    });
  });

  it("о других — только «заявлено» со ссылкой или «уточняйте»; ни одного «у них нет»", () => {
    for (const a of AREAS) {
      for (const c of [a.salesDoctor, a.smartup]) {
        if (!c) continue;
        expect(c.text.ru, a.area.ru).toMatch(/^Заявлен[оаы]?[: ]/);
        expect(c.text.uz.toLowerCase(), a.area.uz).toContain("e'lon qilingan");
        expect(SOURCES[c.source], c.source).toBeTruthy();
      }
    }
    draw();
    const negative = /у них нет|нет у (sales doctor|smartup)|не умеет|не может|отсутствует/i;
    for (const cell of screen.getAllByTestId("compare-claim")) expect(cell.textContent, cell.textContent!).not.toMatch(negative);
    for (const p of screen.getAllByTestId("compare-player")) expect(p.textContent).not.toMatch(negative);
  });

  it("каждая ссылка «[источник]» в ячейке ведёт к источнику на странице: адрес https и дата", () => {
    const { container } = draw();
    const anchors = Array.from(container.querySelectorAll<HTMLAnchorElement>('[data-testid="compare-claim"] a[href^="#manba-"]'));
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) {
      const target = container.querySelector(a.getAttribute("href")!);
      expect(target, a.getAttribute("href")!).not.toBeNull();
      expect(target!.getAttribute("data-testid")).toBe("compare-source");
    }
    for (const s of screen.getAllByTestId("compare-source")) {
      expect(s.getAttribute("href")).toMatch(/^https:\/\//);
      expect(s.textContent).toMatch(/\d{2}\.\d{2}\.\d{4}/);
    }
    // Ни одного источника «про запас»: каждый ключ на странице виден.
    const shown = new Set(screen.getAllByTestId("compare-source").map(s => s.id.replace("manba-", "")));
    for (const k of Object.keys(SOURCES)) expect(shown.has(k), k).toBe(true);
  });

  it("чего нет у нас — сказано в нашей колонке и в разделе «Чего нет»", () => {
    draw();
    const gapRows = screen.getAllByTestId("compare-ours").filter(c => c.getAttribute("data-gap") === "yes");
    expect(gapRows.length).toBe(AREAS.filter(a => a.oursGap).length);
    expect(gapRows.some(c => /Asl Belgisi/.test(c.textContent!))).toBe(true);
    expect(screen.getAllByTestId("compare-gap")).toHaveLength(GAPS.length);
  });
});

describe("цена, переход, дата сверки", () => {
  it("цена и минимум — из модуля цен", () => {
    draw();
    const first = screen.getAllByTestId("compare-answer")[0].textContent!;
    expect(first).toContain(formatSum(FIELD_PRICE_UZS));
    expect(first).toContain(`от ${MIN_FIELD_USERS} человек`);
  });

  it("кнопки ведут на регистрацию и демо; дата сверки видна", () => {
    draw();
    expect(screen.getByTestId("compare-cta-register").getAttribute("href")).toBe("/register");
    expect(screen.getByTestId("compare-cta-demo").getAttribute("href")).toBe("/demo");
    expect(screen.getByTestId("compare-hero").textContent).toContain(CHECKED_AT);
    expect(screen.getAllByTestId("compare-step")).toHaveLength(STEPS.length);
  });
});

describe("язык", () => {
  it("без выбора — русский, и выбор не записывается сам", () => {
    draw();
    expect(screen.getByTestId("pitch-lang-ru").getAttribute("aria-pressed")).toBe("true");
    expect(document.documentElement.lang).toBe("ru");
    expect(localStorage.getItem("lang")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Выбираете систему для дистрибуции?");
  });

  it("переключатель на узбекский: заголовок, ячейки и «уточняйте» — по-узбекски", () => {
    draw();
    fireEvent.click(screen.getByTestId("pitch-lang-uz"));
    expect(localStorage.getItem("lang")).toBe("uz");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Distribyutsiya uchun tizim tanlayapsizmi?");
    const unclaimed = screen.getAllByTestId("compare-claim").filter(c => c.getAttribute("data-claimed") === "no");
    expect(unclaimed.length).toBeGreaterThan(0);
    for (const c of unclaimed) expect(c.textContent).toContain("Kompaniyadan aniqlang");
  });

  it("тексты обоих языков не пустые", () => {
    const all: L[] = [
      ...AREAS.flatMap(a => [a.area, a.ours, ...[a.salesDoctor, a.smartup].flatMap(c => (c ? [c.text] : []))]),
      ...QUESTIONS.flatMap(q => [q.q, q.a]),
      ...PLAYERS.flatMap(p => [p.what, ...p.facts]),
      ...STEPS.flatMap(s => [s.t, s.d]),
    ];
    for (const l of all) {
      expect(l.ru.trim(), l.uz).not.toBe("");
      expect(l.uz.trim(), l.ru).not.toBe("");
    }
  });
});
