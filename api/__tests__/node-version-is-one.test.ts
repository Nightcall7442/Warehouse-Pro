/**
 * Node одной версии везде: в боевом образе, в каждом задании CI, в engines и
 * в описании типов.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Версия Node записана в семи местах четырёх файлов CI, в Dockerfile, в
 * engines и — неявно — в мажоре @types/node. Меняют их руками, и они
 * расходились: бой и CI стояли на 22, разработка — на 24, а типы уже
 * описывали API 24-й. Код, который зовёт функцию, появившуюся в 24, проходил
 * проверку типов и падал бы только в бою. Проверки, прошедшие в CI на одной
 * версии, ничего не говорят о поведении на другой: так при переходе 20 → 22
 * одиннадцать проверок не выполнялись в CI ни разу (node:sqlite появился в
 * 22.5), и это заметили не сразу.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Мажор из Dockerfile совпадает с node-version в каждом задании каждого
 * потока, с нижней границей engines и с мажором @types/node. И ни одно
 * задание не ставит Node без явной версии: без неё раннер отдаёт свою, какую
 * захочет.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const read = (file: string) => readFileSync(resolve(ROOT, file), "utf-8");

/** Мажор боевого образа: от него сверяется всё остальное. */
function dockerMajor(): number {
  const froms = [...read("Dockerfile").matchAll(/^FROM\s+node:(\d+)[\w.-]*/gm)].map(m => Number(m[1]));
  expect(froms.length, "в Dockerfile нет строки FROM node:…").toBeGreaterThan(0);
  expect(new Set(froms).size, "стадии Dockerfile собраны на разных Node").toBe(1);
  return froms[0];
}

const WORKFLOWS = readdirSync(resolve(ROOT, ".github/workflows"))
  .filter(f => /\.ya?ml$/.test(f))
  .map(f => `.github/workflows/${f}`);

describe("Node одной версии в образе, CI, engines и типах", () => {
  const major = dockerMajor();

  it("файлы потоков найдены", () => {
    expect(WORKFLOWS.length).toBeGreaterThan(0);
  });

  for (const file of WORKFLOWS) {
    it(`${file}: каждое задание ставит Node ${major}`, () => {
      const src = read(file);
      const setups = src.match(/uses:\s*actions\/setup-node@/g)?.length ?? 0;
      const versions = [...src.matchAll(/node-version:\s*["']?([^\s"']+)["']?/g)].map(m => m[1]);
      expect(versions.length, `${file}: setup-node без node-version — раннер поставит свою версию`).toBe(setups);
      for (const v of versions) {
        expect(v, `${file}: node-version не совпадает с Dockerfile`).toBe(String(major));
      }
    });
  }

  it(`engines в package.json требует Node ${major}`, () => {
    const pkg = JSON.parse(read("package.json"));
    const floor = String(pkg.engines?.node ?? "").match(/^>=\s*(\d+)(?:\.\d+){0,2}$/);
    expect(floor, `engines.node должно быть вида ">=${major}.x.y", сейчас «${pkg.engines?.node}»`).not.toBeNull();
    expect(Number(floor![1]), "engines.node разошёлся с Dockerfile").toBe(major);
  });

  it(`и в файле блокировки — тот же engines`, () => {
    // npm ci сверяет package.json с блокировкой; правка только одного из них
    // — признак того, что блокировку правили руками.
    const pkg = JSON.parse(read("package.json"));
    const lock = JSON.parse(read("package-lock.json"));
    expect(lock.packages[""].engines?.node).toBe(pkg.engines?.node);
  });

  it(`@types/node описывает Node ${major}, а не другой`, () => {
    const pkg = JSON.parse(read("package.json"));
    const range = String(pkg.devDependencies?.["@types/node"] ?? "");
    const m = range.match(/^[~^]?(\d+)\./);
    expect(m, `@types/node задан непривычно: «${range}»`).not.toBeNull();
    expect(Number(m![1]), "типы описывают API другой версии Node, чем в бою").toBe(major);
  });
});
