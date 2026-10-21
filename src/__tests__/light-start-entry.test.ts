import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Лёгкий старт: во вход не едут запись сеансов, лендинг и exceljs, а гость
 * на сайте не качает приложение.
 *
 * Что было: входной файл весил ~1 МБ (332 КБ gzip). В нём ехали запись
 * сеансов Sentry (Replay/rrweb, ~128 КБ) и весь лендинг (~170 КБ), хотя
 * лендинг видит только гость, а запись нужна лишь после ошибки. exceljs
 * (~940 КБ) стоял в предзагрузке каждой страницы с кнопкой выгрузки: агент,
 * открывая «KPI» или «Магазины» на телефоне, качал библиотеку Excel. Дешёвый
 * Android разбирал всё это до первого экрана. А гость на лендинге качал
 * приложение целиком — 800 КБ входа, tRPC с react-query, запросы auth.me и
 * warehouseMulti.list — ради одной страницы и одной формы.
 *
 * Теперь вход (src/main.tsx) только выбирает: приложение (src/app-main.tsx)
 * или лёгкий сайт (src/site/site-main.tsx) — гостю на готовой странице сайта.
 *
 * Что проверяется:
 *   · по исходникам — сам вход ничего тяжёлого не тянет; граф СТАТИЧЕСКИХ
 *     импортов приложения не доходит до лендинга и до src/sentry-replay.ts,
 *     а replayIntegration() не зовётся ни в одном файле этого графа;
 *     сайт — ни статически, ни через свои ленивые страницы — не доходит до
 *     tRPC с react-query, useAuth, WarehouseProvider, подсказок PWA и
 *     Sentry с трассировкой; exceljs статически не импортирует никто;
 *   · страж сам не слепой: тот же обход С динамическими импортами до
 *     лендинга, записи, приложения и сайта доходит — пути разрешаются;
 *   · по собранному dist (если он есть — после npm run build): вход крошечный;
 *     старт приложения (его кусок и всё, что он тянет статически) не содержит
 *     rrweb, формы лендинга и ссылки на exceljs и не толще потолка; старт
 *     сайта не содержит ни react-query, ни трассировки, ни service worker.
 *
 * Нарочная поломка: верни `import Landing from "./pages/Landing"` в App.tsx —
 * падает «лендинг»; верни Sentry.replayIntegration(...) в init (src/sentry.ts)
 * — падает «запись сеансов»; верни `import ExcelJS from "exceljs"` в
 * src/lib/excel.ts — падает «exceljs»; верни в LeadForm
 * `import { trpc } from "@/providers/trpc"` — падает «сайт без приложения»
 * (и в dist — «старт сайта без react-query»); импортируй в src/main.tsx
 * `./app-main` статически — падает «вход только выбирает». Та же пара
 * поломок (лендинг и exceljs) после `vite build` роняет и dist: «нет формы
 * лендинга», «нет ссылки на exceljs».
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
const APP_MAIN = path.join(SRC, "app-main.tsx");
const SITE_MAIN = path.join(SRC, "site", "site-main.tsx");
const LANDING = path.join(SRC, "pages", "Landing.tsx");
const REPLAY = path.join(SRC, "sentry-replay.ts");
const src = (p: string) => path.join(SRC, p);

/** Первый импорт файла — то, что выполнится раньше всего остального. */
const firstImport = (file: string) => specsOf(file, false)[0];

describe("исходники: вход только выбирает", () => {
  const eager = reachable(MAIN, false);

  it("страж не слепой: с динамическими импортами до приложения, сайта, лендинга и записи доходит", () => {
    const all = reachable(MAIN, true);
    for (const f of [APP_MAIN, SITE_MAIN, LANDING, REPLAY]) expect(all.files.has(f), rel(f)).toBe(true);
  });

  it("сам вход не тянет ни приложения, ни сайта, ни Sentry", () => {
    for (const f of [APP_MAIN, SITE_MAIN, src("App.tsx"), src("sentry.ts"), src("providers/trpc.tsx"), LANDING]) {
      expect(eager.files.has(f), `${rel(f)} статически достижим из src/main.tsx`).toBe(false);
    }
    expect([...eager.packages], "пакеты во входе").toEqual([]);
  });
});

describe("исходники: что приложение тянет статически", () => {
  const eager = reachable(APP_MAIN, false);

  it("страж не слепой: приложение и Sentry в графе", () => {
    expect(eager.files.has(src("App.tsx"))).toBe(true);
    expect(eager.files.has(src("sentry.ts"))).toBe(true);
    expect(eager.files.size).toBeGreaterThan(30);
  });

  it("лендинг — отдельным куском, а не во входе приложения", () => {
    expect(eager.files.has(LANDING), "src/pages/Landing.tsx статически достижим из src/app-main.tsx").toBe(false);
  });

  it("запись сеансов (Replay/rrweb) — отдельным куском", () => {
    expect(eager.files.has(REPLAY), "src/sentry-replay.ts статически достижим из src/app-main.tsx").toBe(false);
    const callers = [...eager.files]
      .filter(f => /\.(ts|tsx)$/.test(f))
      .filter(f => /\breplayIntegration\s*\(/.test(stripComments(readFileSync(f, "utf8"))))
      .map(rel);
    expect(callers, "replayIntegration() зовётся во входном графе").toEqual([]);
  });

  it("Sentry — первым импортом приложения: ошибки ловятся с первой секунды", () => {
    const sentry = stripComments(readFileSync(src("sentry.ts"), "utf8"));
    expect(firstImport(APP_MAIN)).toBe("./sentry");
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
  Сайт для гостя. Проверяется граф С ленивыми страницами: лендинг,
  сравнение и политика грузятся следом за входом сайта, и react-query,
  пришедший с любой из них, был бы у гостя на первом же экране.
*/
const APP_ONLY = [
  "providers/trpc.tsx", "providers/trpc.client.ts", "hooks/useAuth.ts", "providers/WarehouseContext.tsx",
  "components/InstallPrompt.tsx", "components/UpdatePrompt.tsx", "App.tsx", "sentry.ts", "sentry-replay.ts", "app-main.tsx",
].map(src);
const APP_PACKAGES = ["@tanstack/react-query", "@trpc/react-query", "virtual:pwa-register/react", "virtual:pwa-register"];

describe("исходники: сайт без приложения", () => {
  const eager = reachable(SITE_MAIN, false);
  const all = reachable(SITE_MAIN, true);

  it("страж не слепой: страницы сайта, форма заявки и её клиент — в графе", () => {
    for (const f of [LANDING, src("pages/Compare.tsx"), src("pages/Privacy.tsx"), src("components/landing/LeadForm.tsx"), src("lib/public-api.ts"), src("sentry-lite.ts")]) {
      expect(all.files.has(f), rel(f)).toBe(true);
    }
    expect(all.packages.has("@trpc/client")).toBe(true);
  });

  it("ни вход сайта, ни его страницы не тянут tRPC с react-query, useAuth, склады, PWA и трассировку", () => {
    const leaked = APP_ONLY.filter(f => all.files.has(f)).map(rel);
    expect(leaked, "сайт дотянулся до приложения").toEqual([]);
    expect(APP_PACKAGES.filter(p => all.packages.has(p)), "пакеты приложения в сайте").toEqual([]);
    const tracing = [...all.files]
      .filter(f => /\.(ts|tsx)$/.test(f))
      .filter(f => /\b(browserTracingIntegration|replayIntegration)\s*\(/.test(stripComments(readFileSync(f, "utf8"))))
      .map(rel);
    expect(tracing, "трассировка или запись сеанса в сайте").toEqual([]);
  });

  it("Sentry без трассировки — первым импортом сайта", () => {
    expect(firstImport(SITE_MAIN)).toBe("@/sentry-lite");
    expect(eager.files.has(src("sentry-lite.ts"))).toBe(true);
    expect(stripComments(readFileSync(src("sentry-lite.ts"), "utf8"))).toMatch(/Sentry\.init\(/);
  });

  it("лендинг — ленивым куском и у сайта: вход сайта его статически не тянет", () => {
    expect(eager.files.has(LANDING)).toBe(false);
  });
});

/*
  Собранный dist — второй, независимый взгляд: граф выше читает исходники
  регулярным выражением, а сборщик мог бы склеить куски по-своему. Куски
  находятся по карте сборки Vite (build.manifest): пререндер уносит её из
  dist/public в dist/prerender, без пререндера она остаётся на месте. Есть
  только после `npm run build`; без сборки пропускается.
*/
const DIST = path.join(ROOT, "dist", "public");
const MANIFEST = [path.join(ROOT, "dist", "prerender", "build-manifest.json"), path.join(DIST, ".vite", "manifest.json")].find(f => existsSync(f));
const built = existsSync(path.join(DIST, "index.html")) && MANIFEST !== undefined;

type Chunk = { file: string; name?: string; src?: string; imports?: string[]; isEntry?: boolean };

describe.skipIf(!built)("dist: вход, старт приложения и старт сайта", () => {
  const manifest: Record<string, Chunk> = built ? JSON.parse(readFileSync(MANIFEST!, "utf8")) : {};
  const keyOf = (pred: (c: Chunk) => boolean) => Object.keys(manifest).find(k => pred(manifest[k]));
  /** Кусок и всё, что он тянет статически (import, а не import()). */
  const closure = (key: string | undefined, seen = new Set<string>()): Set<string> => {
    if (!key || seen.has(key)) return seen;
    seen.add(key);
    for (const k of manifest[key].imports ?? []) closure(k, seen);
    return seen;
  };
  const files = (keys: Set<string>) => [...keys].map(k => manifest[k].file);
  const code = (keys: Set<string>) => files(keys).map(f => readFileSync(path.join(DIST, f), "utf8")).join("\n");
  const bytes = (keys: Set<string>) => files(keys).reduce((n, f) => n + statSync(path.join(DIST, f)).size, 0);

  const entry = keyOf(c => c.isEntry === true);
  const app = closure(keyOf(c => c.src === "src/app-main.tsx" || c.name === "app-main"));
  const site = closure(keyOf(c => c.src === "src/site/site-main.tsx"));
  const landing = closure(keyOf(c => c.src === "src/pages/Landing.tsx"));

  it("вход найден и он крошечный: только выбор между приложением и сайтом", () => {
    const html = readFileSync(path.join(DIST, "index.html"), "utf8");
    expect(entry).toBeDefined();
    expect(html).toContain(`src="/${manifest[entry!].file}"`);
    expect(statSync(path.join(DIST, manifest[entry!].file)).size).toBeLessThan(16 * 1024);
    expect(app.size).toBeGreaterThan(1);
    expect(site.size).toBeGreaterThan(1);
  });

  it("старт приложения: нет rrweb (записи сеансов)", () => {
    expect(code(app).includes("rrweb")).toBe(false);
  });

  it("старт приложения: нет формы лендинга", () => {
    expect(code(app).includes("lead-submit")).toBe(false);
  });

  it("старт приложения: нет ссылки на exceljs — ни кодом, ни в списке предзагрузки", () => {
    expect(/exceljs/.test(code(app))).toBe(false);
  });

  it("старт приложения не толще 800 КБ (было 1 044 КБ одним входом)", () => {
    // Потолок с запасом на рост приложения; вернуть любой из трёх кусков — перешагнуть его.
    expect(bytes(app)).toBeLessThan(800 * 1024);
  });

  it("старт сайта и лендинг: ни react-query, ни складов, ни трассировки, ни service worker", () => {
    // Метки — строки из кода, которые сборщик не сжимает: текст ошибки
    // react-query, имя процедуры WarehouseProvider, имя интеграции
    // трассировки, адрес service worker. В старте приложения они есть — иначе
    // проверка ничего не видит.
    const MARKS = ["No QueryClient set", "warehouseMulti", "BrowserTracing", "sw.js"];
    const appCode = code(app);
    for (const m of MARKS) expect(appCode.includes(m), `метка «${m}» пропала из приложения — проверка ослепла`).toBe(true);
    const siteCode = code(site) + code(landing);
    expect(MARKS.filter(m => siteCode.includes(m))).toEqual([]);
    expect(code(landing).includes("lead-submit"), "форма заявки — в куске лендинга").toBe(true);
  });

  it("старт сайта вдвое легче старта приложения", () => {
    expect(bytes(site) * 2).toBeLessThan(bytes(app));
  });
});
