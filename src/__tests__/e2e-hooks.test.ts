import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Опоры сквозных проверок.
 *
 * Сами сквозные проверки здесь не выполняются — им нужна база и поднятое
 * приложение, это делает CI. Но одну их поломку можно поймать заранее и
 * дёшево: метку data-testid переименовали или удалили, а тест по ней ищет.
 * Такой тест упадёт в CI через десять минут вместо десяти секунд здесь.
 *
 * Заодно проверяется, что набор не сползает обратно к «нажать, если элемент
 * виден» — обёртка, из-за которой прежний набор проходил на любом коде.
 */

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const E2E = walk(join(ROOT, "e2e"));
const SRC = walk(join(ROOT, "src")).filter(f => !f.includes("__tests__"));
const SRC_TEXT = SRC.map(f => readFileSync(f, "utf8")).join("\n");
const E2E_TEXT = E2E.map(f => readFileSync(f, "utf8")).join("\n");

/** Метки, которые сквозные проверки ищут на экране. */
function requestedTestIds(): string[] {
  const ids = new Set<string>();
  for (const m of E2E_TEXT.matchAll(/getByTestId\(\s*(["'`])([^"'`$]+)\1\s*\)/g)) ids.add(m[2]);
  // Метки с подстановкой (`product-qty-${id}`) сверяются по неизменной части.
  for (const m of E2E_TEXT.matchAll(/getByTestId\(\s*`([^`$]+)\$\{/g)) ids.add(m[1]);
  return [...ids].sort();
}

describe("сквозные проверки цепляются за существующие метки", () => {
  const ids = requestedTestIds();

  it("метки вообще найдены — иначе проверка ниже бессмысленна", () => {
    // Без этого сломавшийся разбор дал бы пустой список и зелёный результат на
    // чём угодно.
    expect(ids.length, "в e2e не нашлось ни одной getByTestId").toBeGreaterThanOrEqual(8);
  });

  for (const id of ids) {
    it(`«${id}» есть в коде приложения`, () => {
      // Точное совпадение для обычных, начало строки — для составных.
      const exact = SRC_TEXT.includes(`data-testid="${id}"`);
      const templated = SRC_TEXT.includes("data-testid={`" + id);
      expect(
        exact || templated,
        `сквозная проверка ищет data-testid="${id}", а в src такой метки нет — ` +
          "тест упадёт в CI, а не здесь",
      ).toBe(true);
    });
  }
});

describe("сквозные проверки не возвращаются к «нажать, если видно»", () => {
  it("ни одного isVisible в сценариях", () => {
    // Шаг, обёрнутый в проверку видимости, молча пропускается, когда элемента
    // нет: кнопки не стало — шаг пропущен — сценарий зелёный. Ждать элемент
    // нужно ожиданием, а не спрашивать, есть ли он.
    const hits: string[] = [];
    for (const f of E2E) {
      const n = (readFileSync(f, "utf8").match(/isVisible\(/g) ?? []).length;
      if (n) hits.push(`${f.slice(ROOT.length + 1)}: ${n}`);
    }
    expect(hits, "вернулась обёртка, из-за которой прежний набор проходил всегда").toEqual([]);
  });

  it("ни одного всегда-истинного ожидания", () => {
    // `expect(count).toBeGreaterThanOrEqual(0)` — такое ожидание не может не
    // выполниться. В прежнем наборе оно стояло вместо проверки платежей.
    const tautologies = [...E2E_TEXT.matchAll(/toBeGreaterThanOrEqual\(\s*0\s*\)/g)].length;
    expect(tautologies, "ожидание, которое выполняется при любом ответе").toBe(0);
  });

  it("каждый сценарий что-то утверждает про данные, а не только про вид", () => {
    // Проверка «элемент виден» отличает белую страницу от небелой и ничего
    // больше. Заказ можно провести так, что бирка появится, а остаток не
    // спишется, — поэтому в каждом файле должно быть и ожидание про значения.
    for (const f of E2E.filter(f => f.endsWith(".spec.ts"))) {
      const src = readFileSync(f, "utf8");
      const visualOnly = /toBeVisible|toBeEnabled|toHaveTitle/;
      const aboutData = /\.toBe\(|\.toEqual\(|toBeGreaterThan|expect\.poll|toMatchObject/;
      expect(
        aboutData.test(src),
        `${f.slice(ROOT.length + 1)} проверяет только внешний вид` +
          (visualOnly.test(src) ? "" : " и вообще ничего не проверяет"),
      ).toBe(true);
    }
  });
});
