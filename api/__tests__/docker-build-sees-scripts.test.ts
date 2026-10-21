import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Сборка в образе видит всё, к чему обращается `npm run build`.
 *
 * Сборочная стадия Dockerfile копирует папки поимённо (api, db, contracts,
 * src, public…). Локально и в CI на месте весь репозиторий, поэтому шаг
 * сборки, который зовёт файл из папки, забытой в списке, падает только при
 * выкладке — в Railway, на глазах у всех. Ближайший такой шаг — готовые
 * страницы сайта (`node scripts/…` после vite build); папка scripts/ в
 * образе нужна до него, а не вместе с ним.
 *
 * Нарочная поломка: убрать `COPY scripts/ scripts/` — падает второй; дописать
 * в "build" вызов файла из папки, которой нет в COPY, — первый.
 */
const ROOT = resolve(import.meta.dirname, "../..");
const docker = readFileSync(resolve(ROOT, "Dockerfile"), "utf8");
const builder = docker.slice(docker.indexOf("AS builder"), docker.indexOf("AS runtime"));
const copied = new Set([...builder.matchAll(/^COPY\s+(\S+)\/\s/gm)].map(m => m[1]));
const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };

describe("Dockerfile: сборочная стадия", () => {
  it("каждая папка, к файлам которой обращается npm run build, скопирована до сборки", () => {
    const dirs = [...pkg.scripts.build.matchAll(/(?:^|[\s"'=])([a-z][\w-]*)\/[\w./-]+\.(?:ts|tsx|mjs|cjs|js)\b/g)].map(m => m[1]);
    expect(dirs.length, "в build не нашлось ни одного пути — страж ослеп").toBeGreaterThan(0);
    for (const d of dirs) expect(copied.has(d), `npm run build зовёт ${d}/…, а в образ папка не копируется`).toBe(true);
  });

  it("папка scripts/ — в образе сборки", () => {
    expect(copied.has("scripts")).toBe(true);
  });
});
