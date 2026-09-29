/**
 * Каждый пакет из dependencies где-то импортируется.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * @opentelemetry/auto-instrumentations-node стоял в dependencies с тех пор,
 * как трассировку перевели на ручные промежутки (api/lib/telemetry.ts), —
 * там же было записано, что он не используется и его стоит убрать. Не
 * импортировал его никто: ни сервер, ни скрипты, ни Dockerfile. Но
 * dependencies — это то, что ставит `npm ci --omit=dev` в боевой образ, и он
 * тянул за собой сотню пакетов: 521 пакет в образе против 391 без него.
 * Каждый — лишний вес выкладки и лишняя строка в отчёте об уязвимостях.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Для каждого пакета из dependencies в исходниках (api, src, db, contracts,
 * scripts, e2e и конфигурации в корне) есть импорт: `from "пакет"`,
 * `import("пакет")`, `require("пакет")` или подпуть вида `пакет/что-то`.
 * Пакет, нужный только при сборке, живёт в devDependencies и в образ не
 * попадает — его эта проверка не трогает.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(__dirname, "../..");
const DIRS = ["api", "src", "db", "contracts", "scripts", "e2e"];
const SKIP = new Set(["node_modules", "dist", "coverage"]);
const EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (EXT.test(name)) out.push(path);
  }
  return out;
}

const files = [
  ...DIRS.flatMap(d => sources(resolve(ROOT, d))),
  ...readdirSync(ROOT).filter(n => EXT.test(n)).map(n => resolve(ROOT, n)),
];
const text = files.map(f => readFileSync(f, "utf-8"));

function isImported(pkg: string): boolean {
  const name = pkg.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const re = new RegExp(String.raw`(?:from\s+|import\s*\(\s*|require\(\s*|import\s+)["']` + name + String.raw`(?:/[^"']*)?["']`);
  return text.some(s => re.test(s));
}

describe("в dependencies нет пакетов, которые никто не зовёт", () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf-8"));

  it("исходники найдены", () => {
    // Иначе пустой обход сделал бы проверку ниже зелёной при любых пакетах.
    expect(files.length).toBeGreaterThan(100);
    expect(isImported("react"), "поиск импортов не видит даже react").toBe(true);
  });

  it("каждый пакет из dependencies импортируется", () => {
    const unused = Object.keys(pkg.dependencies ?? {}).filter(d => !isImported(d));
    expect(
      unused,
      "Пакет в dependencies уходит в боевой образ вместе со всеми своими " +
        "зависимостями. Не используется — удалите (npm uninstall); нужен только " +
        "при сборке — перенесите в devDependencies.",
    ).toEqual([]);
  });
});
