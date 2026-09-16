// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LangProvider } from "@/i18n";
import { scrubProgress, frameAt, captionOpacity } from "@/components/landing/scroll-scrub";

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
