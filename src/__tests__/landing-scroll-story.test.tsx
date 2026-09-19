// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { LangProvider } from "@/i18n";
import { scrubProgress, frameAt, captionOpacity } from "@/components/landing/scroll-scrub";
import { FILM, WAREHOUSE_ACTS, windowOpacity, frameInset } from "@/components/landing/film";

/**
 * Плёнка «от заказа до денег» (Apple-style scroll scrub).
 *
 *   · арифметика прогресса, кадра и подписи — чистая и стережётся числами;
 *   · сцена: секция выше экрана, сцена прилипает; при «уменьшить движение»
 *     секция обычной высоты, подписи списком, ничего не спрятано;
 *   · ничего не прячется разметкой: без сценария все подписи видны;
 *   · кадры — снимки настоящей программы через shots.ts, под холстом всегда
 *     лежит первый кадр картинкой; цвета — только LX.*;
 *   · интерлюдия стоит перед главой «Заказы» и не имеет номера — нумерация
 *     глав не сдвигается.
 */
const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8").replace(/\r\n/g, "\n");

describe("арифметика плёнки", () => {
  it("прогресс сквозь секцию: до входа 0, у нижнего края 1, посередине — доля пути", () => {
    expect(scrubProgress(200, 3000, 900)).toBe(0);
    expect(scrubProgress(0, 3000, 900)).toBe(0);
    expect(scrubProgress(-1050, 3000, 900)).toBe(0.5);
    expect(scrubProgress(-2100, 3000, 900)).toBe(1);
    expect(scrubProgress(-9999, 3000, 900)).toBe(1);
    expect(scrubProgress(10, 500, 900)).toBe(0);
    expect(scrubProgress(-1, 500, 900)).toBe(1);
  });
  it("кадр и доля к следующему; последний кадр не выходит за плёнку", () => {
    expect(frameAt(0, 4)).toEqual([0, 0]);
    expect(frameAt(0.37, 4)[0]).toBe(1);
    expect(frameAt(0.37, 4)[1]).toBeCloseTo(0.11, 5);
    expect(frameAt(1, 4)).toEqual([2, 1]);
    expect(frameAt(0.5, 1)).toEqual([0, 0]);
    expect(frameAt(-1, 4)).toEqual([0, 0]);
  });
  it("подписи: своя — целиком, соседние — крест-накрест на границе, края не пустые", () => {
    expect(captionOpacity(0, 0, 4)).toBe(1);
    expect(captionOpacity(0, 1, 4)).toBe(0);
    expect(captionOpacity(0.25, 0, 4)).toBe(0.5);
    expect(captionOpacity(0.25, 1, 4)).toBe(0.5);
    expect(captionOpacity(0.375, 1, 4)).toBe(1);
    expect(captionOpacity(1, 3, 4)).toBe(1);
    expect(captionOpacity(1, 2, 4)).toBe(0);
    expect(captionOpacity(0.7, 0, 1)).toBe(1);
  });
});

describe("сцена", () => {
  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } root = null; rootMargin = ""; thresholds = []; });
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    // jsdom холста не рисует и ругается в консоль; под холстом всё равно лежит картинка.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  const mm = (reduce: boolean) => vi.stubGlobal("matchMedia", (q: string) => ({ matches: reduce && q.includes("reduce"), media: q, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() }));

  it("секция выше экрана, сцена прилипает; первый кадр — картинкой под холстом; подписи не спрятаны разметкой", async () => {
    mm(false);
    const { default: StoryScroll } = await import("@/components/landing/StoryScroll");
    const { container } = render(<LangProvider><StoryScroll /></LangProvider>);
    const section = container.querySelector("#story") as HTMLElement;
    expect(section.style.height).toBe("320vh");
    expect(section.querySelector(".sticky")).toBeTruthy();
    const imgs = Array.from(section.querySelectorAll("img")).map(i => i.getAttribute("src"));
    expect(imgs).toEqual(["/landing/ru/web-operator-orders-content.webp", "/landing/ru/mobile-agent-order-step2.webp"]);
    expect(section.querySelectorAll("canvas").length).toBe(2);
    const steps = Array.from(section.querySelectorAll("[data-story-step]")) as HTMLElement[];
    expect(steps.length).toBe(4);
    // Сценарий выставил состояние из JS: ровно одна подпись видна (в jsdom секция без высоты — прогресс 1, последняя),
    // остальные погашены — но в разметке ничего не спрятано.
    expect(steps.map(s => s.style.opacity).sort()).toEqual(["0", "0", "0", "1"]);
    expect(read("src/components/landing/StoryScroll.tsx")).not.toMatch(/opacity:\s*0\b/);
  });
  it("«уменьшить движение»: секция обычной высоты, без прилипания, четыре подписи списком и все видны", async () => {
    mm(true);
    vi.resetModules();
    const { default: StoryScroll } = await import("@/components/landing/StoryScroll");
    const { container } = render(<LangProvider><StoryScroll /></LangProvider>);
    const section = container.querySelector("#story") as HTMLElement;
    expect(section.style.height).toBe("auto");
    expect(section.querySelector(".sticky")).toBeNull();
    const steps = Array.from(section.querySelectorAll("[data-story-step]")) as HTMLElement[];
    expect(steps.length).toBe(4);
    expect(steps.every(s => s.style.opacity === "" && !s.className.includes("absolute"))).toBe(true);
  });
  it("интерлюдия стоит перед «Заказами» без номера; кадры — из shots.ts; цвета — только LX", () => {
    const landing = read("src/pages/Landing.tsx");
    expect(landing.indexOf("<StoryScroll />")).toBeGreaterThan(0);
    expect(landing.indexOf("<StoryScroll />")).toBeLessThan(landing.indexOf("<OrdersSection />"));
    const src = read("src/components/landing/StoryScroll.tsx");
    expect(src).not.toContain("<SectionHead");
    expect(src).toContain("webContent(s.web, lang)");
    expect(src).toContain("mobileShot(s.phone, lang)");
    for (const f of ["src/components/landing/StoryScroll.tsx", "src/components/landing/SequenceCanvas.tsx", "src/components/landing/scroll-scrub.ts"]) expect(read(f), f).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    // Сглаживание и остановка цикла вне экрана — то, чем плёнка отличается от «сайт заедает».
    const scrub = read("src/components/landing/scroll-scrub.ts");
    expect(scrub).toContain("value.current += d * SMOOTH;");
    expect(scrub).toContain("if (near) raf = requestAnimationFrame(tick);");
    expect(scrub).toContain("if (!el || reducedMotion() || typeof IntersectionObserver === \"undefined\") return;");
  });
});

describe("плёнка из видео (Higgsfield → кадры → прокрутка)", () => {
  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } root = null; rootMargin = ""; thresholds = []; });
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("манифест film.ts сходится с кадрами на диске: столько же файлов, нумерация без дыр, первый кадр есть", () => {
    for (const [name, f] of Object.entries(FILM)) {
      expect(f.widths.length).toBeGreaterThanOrEqual(2);
      for (const w of f.widths) {
        const dir = join(ROOT, "public", "landing", "film", name, `w${w}`);
        expect(existsSync(dir), `нет папки кадров ${name}/w${w}`).toBe(true);
        const files = readdirSync(dir).filter(x => /^\d{3}\.webp$/.test(x)).sort();
        expect(files.length, `кадров ${name}/w${w} на диске не столько, сколько в film.ts`).toBe(f.count);
        expect(files[0]).toBe("001.webp");
        expect(files.at(-1)).toBe(`${String(f.count).padStart(3, "0")}.webp`);
      }
      expect(f.count).toBeGreaterThanOrEqual(24);
      expect(f.width).toBe(Math.max(...f.widths));
      expect(f.width / f.height).toBeCloseTo(16 / 9, 1);
    }
  });
  it("три акта: границы — внутри плёнки, по порядку, и на каждый акт хватает кадров на строку", () => {
    /*
      Третий заход (19.09.2026): владелец назвал плёнку короткой и сделанной
      наспех. Теперь три ролика склеены наплывом; границы актов — индексы
      кадров из cuts.txt песочницы. Акт короче 24 кадров — строка мелькнёт.
    */
    expect(WAREHOUSE_ACTS[0]).toBe(0);
    for (let i = 1; i < WAREHOUSE_ACTS.length; i++) {
      expect(WAREHOUSE_ACTS[i]).toBeGreaterThan(WAREHOUSE_ACTS[i - 1] + 23);
      expect(WAREHOUSE_ACTS[i]).toBeLessThan(FILM.warehouse.count - 24);
    }
    expect(WAREHOUSE_ACTS.length).toBe(3);
    expect(FILM.warehouse.count).toBeGreaterThanOrEqual(120);
  });
  it("строка видна на своём отрезке и гаснет по краям; кадр въезжает вставкой и раскрывается", () => {
    expect(windowOpacity(0.5, 0.3, 0.7, 0.05)).toBe(1);
    expect(windowOpacity(0.3, 0.3, 0.7, 0.05)).toBe(0);
    expect(windowOpacity(0.325, 0.3, 0.7, 0.05)).toBeCloseTo(0.5);
    expect(windowOpacity(0.7, 0.3, 0.7, 0.05)).toBe(0);
    expect(windowOpacity(0, 0.3, 0.7, 0.05)).toBe(0);
    // В самом начале — вставка целиком, к lead — во весь экран, в конце — снова вставка.
    expect(frameInset(0, 0.07)).toBe(1);
    expect(frameInset(0.07, 0.07)).toBe(0);
    expect(frameInset(0.5, 0.07)).toBe(0);
    expect(frameInset(1, 0.07)).toBe(1);
    expect(frameInset(0.035, 0.07)).toBeGreaterThan(0);
    expect(frameInset(0.035, 0.07)).toBeLessThan(0.5); // ease-out: раскрывается быстро
  });
  it("сцена: секция в 520vh, кадры из манифеста по порядку и по ширине экрана, постер — первый кадр, строки не спрятаны разметкой и появляются после раскрытия кадра", async () => {
    const { default: FilmScroll } = await import("@/components/landing/FilmScroll");
    const { pickFilmWidth } = await import("@/components/landing/film");
    // jsdom: окно 1024 точки → хватает 960? нет — 1920. Телефон 390×3 = 1170 → 1920; 375×2 = 750 → 960.
    expect(pickFilmWidth([960, 1920], 750)).toBe(960);
    expect(pickFilmWidth([960, 1920], 1170)).toBe(1920);
    expect(pickFilmWidth([960, 1920], 5000)).toBe(1920);
    const { container } = render(<LangProvider><FilmScroll /></LangProvider>);
    const section = container.querySelector("#film") as HTMLElement;
    expect(section.style.height).toBe("520vh");
    expect(section.querySelector(".sticky")).toBeTruthy();
    expect(section.querySelector("img")?.getAttribute("src")).toMatch(/^\/landing\/film\/warehouse\/w(960|1920)\/001\.webp$/);
    // Плёнка без затухания между кадрами: два кадра с движением камеры, наложенные полупрозрачно, двоят.
    expect(read("src/components/landing/FilmScroll.tsx")).toContain("blend={false}");
    expect(read("src/components/landing/SequenceCanvas.tsx")).toContain("const a = nearest(t < 0.5 ? i : i + 1);");
    const lines = Array.from(section.querySelectorAll("[data-film-line]")) as HTMLElement[];
    expect(lines.length).toBe(3);
    // При p = 0 кадр ещё вставка — строк нет; они появляются после раскрытия
    // (иначе первая резалась краем окна, пока секция въезжала — снимок владельца).
    expect(lines.map(l => l.style.opacity)).toEqual(["0", "0", "0"]);
    expect(read("src/components/landing/FilmScroll.tsx")).not.toMatch(/opacity:\s*0\b/);
    expect(section.querySelector("[data-film-line='1']")?.textContent).toContain("Каждое утро");
    // Первая строка начинается не раньше, чем кадр раскрылся (LEAD), последняя гаснет до сворачивания.
    const scene = read("src/components/landing/FilmScroll.tsx");
    expect(scene).toContain("from: i === 0 ? LEAD + GAP : b + GAP,");
    expect(scene).toContain("to: i === BOUNDS.length - 1 ? 1 - LEAD - GAP : BOUNDS[i + 1] - GAP,");
    expect(scene).toMatch(/const LEAD = 0\.0[5-9];/);
    // Без движения — постер и все три строки списком, ничего не спрятано.
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), media: q, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() }));
    cleanup();
    const stillRender = render(<LangProvider><FilmScroll /></LangProvider>);
    const still = stillRender.container.querySelector("#film") as HTMLElement;
    expect(still.querySelector(".sticky")).toBeNull();
    expect(Array.from(still.querySelectorAll("[data-film-line]")).every(l => (l as HTMLElement).style.opacity === "")).toBe(true);
    expect(read("src/components/landing/FilmScroll.tsx")).toContain("String(i + 1).padStart(3, \"0\")}.webp");
  });
  it("плёнка грузится не при открытии страницы, а в полутора экранах от читателя; стоит в ночной полосе между «потерями» и окном продукта", () => {
    expect(read("src/components/landing/SequenceCanvas.tsx")).toContain('rootMargin: "150% 0px 150% 0px"');
    const landing = read("src/pages/Landing.tsx");
    expect(landing.indexOf("<LossSection />")).toBeLessThan(landing.indexOf("<FilmScroll />"));
    expect(landing.indexOf("<FilmScroll />")).toBeLessThan(landing.indexOf("<ProductWindow />"));
    expect(read("src/components/landing/FilmScroll.tsx")).not.toContain("<SectionHead");
  });
});
