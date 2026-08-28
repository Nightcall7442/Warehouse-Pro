/**
 * Сторож честности набора: тест обязан быть способен упасть.
 *
 * ── Зачем ───────────────────────────────────────────────────────────────────
 *
 * Зелёный набор ничего не значит, если внутри него есть проверки, которые не
 * могут провалиться. Такие находились не по одной:
 *
 *   • `expect(Array.isArray(result)).toBe(true)` на списке доставок — стенд
 *     всегда отдаёт массив, поэтому верни ручка чужие заказы или пустоту,
 *     тест остался бы зелёным;
 *   • два теста «изоляции организаций», которые строили два объекта и сверяли
 *     их между собой — единица равна единице, потому что её туда и положили;
 *   • vi.mock с путём на модуль, которого нет: мок выглядел защитой от
 *     настоящей базы, а был пустой строкой — и целый путь уведомлений в
 *     тестах не выполнялся ни разу.
 *
 * Каждый раз это находил человек, случайно, по постороннему признаку. Такое
 * должна ловить машина.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * 1. У каждого теста есть хотя бы одно ожидание.
 * 2. Каждый vi.mock указывает на существующий модуль.
 * 3. Дорогой набор на настоящей базе не осиротел — CI его гоняет.
 * 4. Число шагов e2e, обёрнутых в «сделать, если элемент виден», не растёт.
 *
 * Списки известного долга ниже могут только сокращаться. Добавлять в них
 * новое — значит заводить тест, который не может упасть; тогда уж лучше не
 * заводить вовсе.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Псевдонимы путей из vitest.config.ts — их надо разворачивать вручную. */
const ALIASES: Record<string, string> = {
  "@db": "db",
  "@contracts": "contracts",
  "@": "src",
  "db": "db",
};

function* testFiles(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", ".git", "coverage"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* testFiles(full);
    else if (/\.(test|spec)\.tsx?$/.test(entry.name)) yield full;
  }
}

const FILES = [...testFiles(ROOT)];
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");
const read = (f: string) => fs.readFileSync(f, "utf8").split("\r\n").join("\n");

/* ────────────────────────────────────────────────────────────────────────────
   1. Тест без единого ожидания
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * Долг: тесты e2e, которые ничего не утверждают.
 *
 * Все они устроены одинаково — цепочка «нажать, если кнопка видна», и ни
 * одного expect в конце. Проходят они всегда, в том числе когда страница не
 * открылась вовсе. Список ждёт переписывания e2e и может только сокращаться.
 */
const NO_ASSERT_DEBT = new Set([
  "e2e/arrivals.spec.ts :: complete arrival updates stock",
  "e2e/arrivals.spec.ts :: delete pending arrival",
  "e2e/orders.spec.ts :: create new order",
  "e2e/orders.spec.ts :: cancel order",
  "e2e/products.spec.ts :: filter by category",
  "e2e/products.spec.ts :: delete product",
]);

/** Заголовки тестов файла вместе с телом каждого — до начала следующего. */
function testsOf(src: string): Array<{ title: string; body: string; modifier: string }> {
  const re = /^[ \t]*(?:it|test)(\.each\([\s\S]*?\))?(\.\w+)?\(\s*([`"'])([\s\S]*?)\3/gm;
  const found: Array<{ index: number; title: string; modifier: string }> = [];
  for (const m of src.matchAll(re)) {
    found.push({ index: m.index ?? 0, title: m[4].split("\n")[0].trim(), modifier: m[2] ?? "" });
  }
  return found.map((f, i) => ({
    title: f.title,
    modifier: f.modifier,
    body: src.slice(f.index, found[i + 1]?.index ?? src.length),
  }));
}

describe("у каждого теста есть хотя бы одно ожидание", () => {
  const offenders: string[] = [];
  for (const file of FILES) {
    if (rel(file).endsWith("tests-are-honest.test.ts")) continue;
    for (const t of testsOf(read(file))) {
      if (/\.(skip|todo|fails|describe)\b/.test(t.modifier)) continue;
      if (/\bexpect\s*\(|\bexpectTypeOf\s*\(|\bassert\./.test(t.body)) continue;
      offenders.push(`${rel(file)} :: ${t.title}`);
    }
  }

  it("новых тестов без ожиданий не появилось", () => {
    const fresh = offenders.filter(o => !NO_ASSERT_DEBT.has(o));
    expect(
      fresh,
      "Тест без единого expect проходит всегда — в том числе когда проверяемого " +
        "не произошло. Добавьте ожидание или удалите тест.",
    ).toEqual([]);
  });

  it("список известного долга не разросся и не устарел", () => {
    // Обе стороны важны. Разросся — долг растёт. Устарел (в списке есть то,
    // чего уже нет) — список надо чистить, иначе он перестаёт быть картой.
    const stale = [...NO_ASSERT_DEBT].filter(d => !offenders.includes(d));
    expect(stale, "Эти тесты уже получили ожидания — уберите их из NO_ASSERT_DEBT").toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   2. vi.mock на несуществующий модуль
   ──────────────────────────────────────────────────────────────────────────── */

describe("каждый vi.mock подменяет существующий модуль", () => {
  const broken: string[] = [];
  const MOCK_RE = /vi\.(?:mock|doMock)\(\s*["'`]([^"'`]+)["'`]/g;

  for (const file of FILES) {
    if (rel(file).endsWith("tests-are-honest.test.ts")) continue;
    for (const m of read(file).matchAll(MOCK_RE)) {
      const spec = m[1];
      let base: string;
      if (spec.startsWith(".")) {
        base = path.resolve(path.dirname(file), spec);
      } else {
        const alias = Object.keys(ALIASES)
          .sort((a, b) => b.length - a.length)
          .find(k => spec === k || spec.startsWith(`${k}/`));
        if (!alias) continue; // пакет из node_modules — не наше дело
        base = path.resolve(ROOT, ALIASES[alias] + spec.slice(alias.length));
      }
      const exists = ["", ".ts", ".tsx", ".js", "/index.ts", "/index.tsx"].some(ext => {
        try { return fs.statSync(base + ext).isFile(); } catch { return false; }
      });
      if (!exists) broken.push(`${rel(file)}  →  "${spec}"`);
    }
  }

  it("нет моков, указывающих в пустоту", () => {
    expect(
      broken,
      "vi.mock считает путь ОТ ФАЙЛА ТЕСТА. Если модуля по этому пути нет, мок " +
        "молча ничего не подменяет: тест выглядит защищённым от настоящей базы " +
        "или сети, а на деле идёт туда. Так целый путь уведомлений не выполнялся " +
        "в тестах ни разу. Чаще всего не хватает одного уровня: из вложенного " +
        "__tests__ путь до api/queries — это ../../queries, а не ../queries.",
    ).toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   3. Дорогой набор не должен осиротеть
   ──────────────────────────────────────────────────────────────────────────── */

describe("проверки на настоящей базе действительно запускаются", () => {
  const ci = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");

  it("в CI есть шаг, который их гоняет", () => {
    // Без этого набор превращается в e2e: написан, лежит в репозитории, при
    // обычном прогоне пропускается за отсутствием TEST_DATABASE_URL — и никто
    // не замечает, что гонки и блокировки не проверяются уже полгода.
    expect(
      /npm run test:db/.test(ci),
      "В .github/workflows/ci.yml пропал шаг «npm run test:db». Проверки на " +
        "настоящей MySQL — единственное место, где вообще проверяются блокировки, " +
        "уникальные индексы и гонки: на заглушке они непроверяемы.",
    ).toBe(true);
  });

  it("шагу отдана настоящая база, а не пустая переменная", () => {
    expect(
      ci.includes("TEST_DATABASE_URL: mysql://"),
      "Шаг есть, но TEST_DATABASE_URL ему не передан — набор пропустится молча.",
    ).toBe(true);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   4. e2e: «сделать, если элемент виден»
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * Сколько шагов e2e сейчас обёрнуто в проверку видимости.
 *
 * Такой шаг молча пропускается, когда элемента нет, — а значит сценарий
 * проходит и на сломанном приложении: кнопки нет, шаг пропущен, тест зелёный.
 * Число зафиксировано и может только уменьшаться.
 */
const IS_VISIBLE_BASELINE = 62;

describe("e2e не прячет шаги за проверкой видимости", () => {
  let count = 0;
  for (const file of FILES) {
    if (!rel(file).startsWith("e2e/")) continue;
    count += (read(file).match(/isVisible\(/g) ?? []).length;
  }

  // Одна проверка на оба направления: выросло — долг увеличили, уменьшилось —
  // порог пора опустить, иначе храповик перестаёт держать.
  it(`их ровно ${IS_VISIBLE_BASELINE}`, () => {
    expect(
      count,
      count > IS_VISIBLE_BASELINE
        ? "Шаг, обёрнутый в «если элемент виден», пропускается молча, и сценарий " +
          "проходит на сломанном приложении: кнопки нет — шаг пропущен — тест зелёный. " +
          "Ждите элемент (locator.waitFor), а не спрашивайте, есть ли он."
        : `Стало меньше (${count}) — опустите IS_VISIBLE_BASELINE до нового числа.`,
    ).toBe(IS_VISIBLE_BASELINE);
  });
});
