import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Лёгкий старт PWA: во входной файл не едут запись сеансов, лендинг и exceljs.
 *
 * Что было: входной файл весил ~1 МБ (332 КБ gzip). В нём ехали запись
 * сеансов Sentry (Replay/rrweb, ~128 КБ) и весь лендинг (~170 КБ), хотя
 * лендинг видит только гость, а запись нужна лишь после ошибки. exceljs
 * (~940 КБ) стоял в предзагрузке каждой страницы с кнопкой выгрузки: агент,
 * открывая «KPI» или «Магазины» на телефоне, качал библиотеку Excel. Дешёвый
 * Android разбирал всё это до первого экрана.
 *
 * Что проверяется:
 *   · по исходникам — граф СТАТИЧЕСКИХ импортов от src/main.tsx не доходит
 *     до лендинга и до src/sentry-replay.ts, а replayIntegration() не
 *     зовётся ни в одном файле этого графа; exceljs статически не
 *     импортирует никто (иначе он снова встанет в предзагрузку страниц);
 *   · страж сам не слепой: тот же обход С динамическими импортами до
 *     лендинга и записи доходит — значит, пути разрешаются;
 *   · по собранному dist (если он есть — после npm run build): входной файл
 *     и всё, что он тянет статически, не содержат rrweb, формы лендинга и
 *     ссылки на exceljs; вход не толще потолка.
 *
 * Нарочная поломка: верни `import Landing from "./pages/Landing"` в App.tsx —
 * падает «лендинг»; верни Sentry.replayIntegration(...) в init (src/sentry.ts)
 * — падает «запись сеансов»; верни `import ExcelJS from "exceljs"` в
 * src/lib/excel.ts — падает «exceljs». Та же пара поломок (лендинг и
 * exceljs) после `vite build` роняет и dist: «нет формы лендинга», «нет
 * ссылки на exceljs», «вход не толще 800 КБ» (вход вырос до 917 КБ).
 */
const ROOT = path.resolve(import.meta.dirname, "../..");
const SRC = path.join(ROOT, "src");
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");

function resolveSpec(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith("@contracts/")) base = path.join(ROOT, "contracts", spec.slice("@contracts/".length));
  else if (spec.startsWith("@db/")) base = path.join(ROOT, "db", spec.slice("@db/".length));
  else if (spec.startsWith("./") || spec.startsWith("../")) base = path.resolve(path.dirname(from), spec);
  else return null; // пакет из node_modules
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const f = base + ext;
    if (existsSync(f) && statSync(f).isFile()) return f;
  }
  return null;
}

/** Код без комментариев: пример импорта в пояснении не должен считаться импортом. */
const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

// import X from "y" / import { a } from "y" / import "y" / export … from "y" — но не import type и не import("y").
const STATIC_IMPORT = /(?:^|[;\n])\s*(import|export)\s+(?!type\s)(?:[^"'`();]*?\bfrom\s*)?["']([^"']+)["']/g;
const DYNAMIC_IMPORT = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

function specsOf(file: string, withDynamic: boolean): string[] {
  const code = stripComments(readFileSync(file, "utf8"));
  const out: string[] = [];
  for (const m of code.matchAll(STATIC_IMPORT)) {
    if (m[1] === "export" && !/\bfrom\s*["']/.test(m[0])) continue; // export const … — не импорт
    out.push(m[2]);
  }
  if (withDynamic) for (const m of code.matchAll(DYNAMIC_IMPORT)) out.push(m[1]);
  return out;
}

function reachable(entry: string, withDynamic: boolean): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const f = queue.pop()!;
    if (files.has(f)) continue;
    files.add(f);
    if (!/\.(ts|tsx)$/.test(f)) continue;
    for (const spec of specsOf(f, withDynamic)) {
      const target = resolveSpec(f, spec);
      if (target) queue.push(target);
      else if (!spec.startsWith(".") && !spec.startsWith("@/")) packages.add(spec);
    }
  }
  return { files, packages };
}

const MAIN = path.join(SRC, "main.tsx");
const LANDING = path.join(SRC, "pages", "Landing.tsx");
const REPLAY = path.join(SRC, "sentry-replay.ts");

describe("исходники: что вход тянет статически", () => {
  const eager = reachable(MAIN, false);

  it("страж не слепой: с динамическими импортами до лендинга и записи доходит", () => {
    const all = reachable(MAIN, true);
    expect(all.files.has(LANDING)).toBe(true);
    expect(all.files.has(REPLAY)).toBe(true);
    expect(eager.files.has(path.join(SRC, "App.tsx"))).toBe(true);
    expect(eager.files.has(path.join(SRC, "sentry.ts"))).toBe(true);
    expect(eager.files.size).toBeGreaterThan(30);
  });

  it("лендинг — отдельным куском, а не во входном файле", () => {
    expect(eager.files.has(LANDING), "src/pages/Landing.tsx статически достижим из src/main.tsx").toBe(false);
  });

  it("запись сеансов (Replay/rrweb) — отдельным куском", () => {
    expect(eager.files.has(REPLAY), "src/sentry-replay.ts статически достижим из src/main.tsx").toBe(false);
    const callers = [...eager.files]
      .filter(f => /\.(ts|tsx)$/.test(f))
      .filter(f => /\breplayIntegration\s*\(/.test(stripComments(readFileSync(f, "utf8"))))
      .map(rel);
    expect(callers, "replayIntegration() зовётся во входном графе").toEqual([]);
  });

  it("Sentry во входном файле остаётся: ошибки ловятся с первой секунды", () => {
    const main = stripComments(readFileSync(MAIN, "utf8"));
    const sentry = stripComments(readFileSync(path.join(SRC, "sentry.ts"), "utf8"));
    expect(main).toMatch(/import\s+["']\.\/sentry["']/);
    expect(sentry).toMatch(/Sentry\.init\(/);
    expect(eager.packages.has("@sentry/react")).toBe(true);
  });

  it("exceljs статически не импортирует никто — иначе он в предзагрузке страниц", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const f = path.join(dir, name);
        if (statSync(f).isDirectory()) { if (name !== "__tests__") walk(f); continue; }
        if (!/\.(ts|tsx)$/.test(name)) continue;
        if (specsOf(f, false).includes("exceljs")) offenders.push(rel(f));
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });
});

/*
  Собранный dist — второй, независимый взгляд: граф выше читает исходники
  регулярным выражением, а сборщик мог бы склеить куски по-своему. Есть
  только после `npm run build`; без сборки пропускается.
*/
const DIST = path.join(ROOT, "dist", "public");
const built = existsSync(path.join(DIST, "index.html"));

describe.skipIf(!built)("dist: входной файл и его статические куски", () => {
  const html = built ? readFileSync(path.join(DIST, "index.html"), "utf8") : "";
  const entry = html.match(/<script[^>]*type="module"[^>]*src="\/(assets\/[^"]+\.js)"/)?.[1] ?? "";
  const chunks = new Set<string>();
  const collect = (file: string) => {
    if (chunks.has(file)) return;
    chunks.add(file);
    const code = readFileSync(path.join(DIST, file), "utf8");
    // Статический импорт в собранном коде: import{…}from"./x.js" / import"./x.js" — но не import("./x.js").
    for (const m of code.matchAll(/(?:import|export)\s*(?:[^"'();]*?from\s*)?["']\.\/([^"']+\.js)["']/g)) collect(`assets/${m[1]}`);
  };
  if (entry) collect(entry);
  const eagerCode = () => [...chunks].map(f => readFileSync(path.join(DIST, f), "utf8")).join("\n");

  it("входной файл найден", () => {
    expect(entry).toMatch(/^assets\/index-.*\.js$/);
  });

  it("нет rrweb (записи сеансов)", () => {
    expect(eagerCode().includes("rrweb")).toBe(false);
  });

  it("нет формы лендинга", () => {
    expect(eagerCode().includes("lead-submit")).toBe(false);
  });

  it("нет ссылки на exceljs — ни кодом, ни в списке предзагрузки", () => {
    expect(/exceljs/.test(eagerCode())).toBe(false);
  });

  it("вход не толще 800 КБ (было 1 044 КБ)", () => {
    // Потолок с запасом на рост приложения; вернуть любой из трёх кусков — перешагнуть его.
    expect(statSync(path.join(DIST, entry)).size).toBeLessThan(800 * 1024);
  });
});
