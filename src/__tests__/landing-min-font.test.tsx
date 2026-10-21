// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";

/**
 * Сайт читается с телефона: ни одной строки мельче 12px, текст — 15–16px.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * На лендинге, сравнении и страницах конкурса стояло полсотни подписей в
 * 10–11,5px (text-[11px], fontSize: 10.5), а абзацы — 13–14px. Директор
 * дистрибьютора смотрит сайт с телефона, часто не молодым глазом; 11px на
 * экране 6" — это шрифт, который не читают, а пропускают. При этом базовый
 * html { font-size: 14px } менять нельзя: на нём построены отступы всего
 * приложения, — поэтому правило держится здесь, по исходникам и по
 * отрисовке.
 *
 * ── Что стережётся ──────────────────────────────────────────────────────────
 *
 *   · исходники сайта (лендинг, сравнение, страницы конкурса): ни одного
 *     размера меньше 12px — классом text-[Npx], стилем fontSize: N или CSS
 *     font-size: Npx. Исключение одно — кольцо и подпись печати (Stamp):
 *     это рисунок aria-hidden, его не читают;
 *   · отрисовка лендинга и сравнения: каждый абзац текста (предложение от 70
 *     знаков) набран не мельче 15px на телефоне — по базовому классу или
 *     стилю, без md:/lg:.
 *
 * Нарочная поломка: вернуть text-[11px] в подпись SectionHead — падает
 * «исходники»; вернуть ответам FAQ text-[14px] — «абзацы лендинга»; вернуть
 * ячейкам сравнения fontSize 14.5 — «абзацы сравнения».
 */
vi.setConfig({ testTimeout: 30_000 });

const ROOT = process.cwd();
const filesIn = (dir: string) =>
  readdirSync(path.join(ROOT, dir)).filter(f => /\.(ts|tsx)$/.test(f)).map(f => path.join(dir, f));

const SITE_FILES = [
  ...filesIn("src/components/landing"),
  ...filesIn("src/components/pitch"),
  ...filesIn("src/components/compare"),
  "src/pages/Landing.tsx",
  "src/pages/Compare.tsx",
  "src/pages/Pitch.tsx",
  "src/pages/PitchDemo.tsx",
];

/** Печать — рисунок, не текст для чтения (aria-hidden, см. Stamp). */
const DECOR = [/fontSize: 8\.5, letterSpacing: 1\.6/];

describe("исходники сайта: ни одной строки мельче 12px", () => {
  it("text-[Npx], fontSize: N и font-size: Npx — не меньше 12", () => {
    const small: string[] = [];
    for (const f of SITE_FILES) {
      const lines = readFileSync(path.join(ROOT, f), "utf8").split("\n");
      lines.forEach((line, i) => {
        if (DECOR.some(re => re.test(line))) return;
        const sizes = [
          ...[...line.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map(m => Number(m[1])),
          ...[...line.matchAll(/fontSize:\s*"?(\d+(?:\.\d+)?)(?:px)?"?(?=[,\s}])/g)].map(m => Number(m[1])),
          ...[...line.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map(m => Number(m[1])),
        ];
        for (const n of sizes) if (n < 12) small.push(`${f}:${i + 1} — ${n}px`);
      });
    }
    expect(small, "мелкий шрифт на сайте").toEqual([]);
  });

  it("страж не слепой: файлов сайта больше двадцати и в них есть размеры", () => {
    expect(SITE_FILES.length).toBeGreaterThan(20);
    const all = SITE_FILES.map(f => readFileSync(path.join(ROOT, f), "utf8")).join("\n");
    expect(all).toMatch(/text-\[12px\]/);
  });
});

/* ── Отрисовка: абзацы ──────────────────────────────────────────────────── */

const leadMutate = vi.fn();
// Форма заявки ходит на сервер голым клиентом сайта (lib/public-api), без
// react-query: заявка «уходит» и ждёт ответа, которого в тесте нет.
vi.mock("@/lib/public-api", () => ({
  createLead: (input: unknown) => { leadMutate(input); return new Promise(() => {}); },
}));

const { default: Landing } = await import("@/pages/Landing");
const { default: Compare } = await import("@/pages/Compare");
const { LangProvider } = await import("@/i18n");

beforeEach(() => {
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

/**
 * Размер на телефоне: базовый класс text-[Npx] (без md:/lg:), стиль или
 * класс p-lead (clamp от 16px, см. pitch-tokens) — у себя или ближайшего
 * предка.
 */
function phoneSize(el: Element | null): number | null {
  for (let n = el; n; n = n.parentElement) {
    const style = (n as HTMLElement).style?.fontSize ?? "";
    const px = /^(\d+(?:\.\d+)?)px$/.exec(style);
    if (px) return Number(px[1]);
    const cls = n.getAttribute("class") ?? "";
    if (/(?:^|\s)p-lead(?:\s|$)/.test(cls)) return 16;
    const m = /(?:^|\s)text-\[(\d+(?:\.\d+)?)px\]/.exec(cls);
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * Моноширинная подпись (номер, сумма, метка кадра) — не абзац: её читают
 * взглядом, как табличку, и она по правилу «не мельче 12px».
 */
function isMono(el: Element): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (/JetBrains Mono/.test((n as HTMLElement).style?.fontFamily ?? "")) return true;
    if (/(?:^|\s)p-mono(?:\s|$)/.test(n.getAttribute("class") ?? "")) return true;
  }
  return false;
}

function smallParagraphs(ui: ReactElement): string[] {
  render(<MemoryRouter><LangProvider>{ui}</LangProvider></MemoryRouter>);
  const out: string[] = [];
  for (const p of Array.from(document.querySelectorAll("p, dd"))) {
    const text = (p.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text.length < 70 || !/\s/.test(text) || isMono(p)) continue;
    const size = phoneSize(p);
    if (size === null || size < 15) out.push(`${size ?? "без размера (14)"}px — «${text.slice(0, 60)}…»`);
  }
  return out;
}

describe("абзацы — 15px и крупнее на телефоне", () => {
  it("абзацы лендинга", () => {
    expect(smallParagraphs(<Landing />)).toEqual([]);
  });

  it("абзацы сравнения", () => {
    expect(smallParagraphs(<Compare />)).toEqual([]);
  });
});
