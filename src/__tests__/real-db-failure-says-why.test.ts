import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Красный real-db обязан говорить, ЧТО сломалось.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Когда база не поднималась или миграция не вставала, все десять наборов
 * краснели одинаково:
 *
 *     SyntaxError: Unexpected end of JSON input
 *
 * По десять раз, без единого слова о причине. Виновата не сама ошибка, а её
 * РАЗБОР: на упавшем `beforeAll` vitest идёт искать карту исходников по кадрам
 * стека, натыкается на файл с обрезанным `sourceMappingURL` и падает уже
 * внутри convert-source-map. Настоящая причина до экрана не доходила вовсе.
 *
 * Проверено снятием: без правки те же десять строк появляются и на пустом
 * порте, и на сломанной миграции — то есть сообщение не зависело от поломки.
 *
 * Стоило это дорого: красный CI, по которому нельзя понять ни базы, ни
 * миграции, ни теста, — это красный CI, который перестают читать.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Что причина ПЕЧАТАЕТСЯ (её увидит и лог, и пометка на странице прогона — см.
 * scripts/ci-run.sh) и что наружу уходит короткая ошибка без кадров, разбирать
 * которую нечего.
 */
const HARNESS = readFileSync(
  join(process.cwd(), "api", "__tests__", "real-db", "harness.ts"),
  "utf8",
).replace(/\r\n/g, "\n");

describe("стенд с настоящей базой объясняет свои падения", () => {
  it("вывод упавшей миграции не теряется", () => {
    /*
      `stdio: "pipe"` уводит вывод drizzle-kit в объект ошибки. Без этого блока
      наверх поднималось голое «Command failed: npx drizzle-kit migrate».
    */
    expect(HARNESS, "вывод drizzle-kit никуда не читается").toContain("err.stdout");
    expect(HARNESS, "поток ошибок drizzle-kit никуда не читается").toContain("err.stderr");
  });

  it("причина печатается, а не только бросается", () => {
    // Единственное место, где она видна целиком, каким бы длинным ни был вывод.
    expect(HARNESS, "причина никуда не выводится").toContain("console.error(");
  });

  it("наружу уходит ошибка без кадров стека", () => {
    /*
      Ровно по кадрам vitest и уходил в разбор карт исходников. Пустой стек —
      не небрежность, а условие того, чтобы сообщение вообще напечаталось.
    */
    const at = HARNESS.indexOf("function brief(");
    expect(at, "помощника brief больше нет").toBeGreaterThan(0);
    const body = HARNESS.slice(at, HARNESS.indexOf("\n}", at));
    expect(body, "стек снова разбирается — сообщение опять потеряется")
      .toContain("err.stack = err.message");
  });

  it("миграции проходят через этого помощника", () => {
    const at = HARNESS.indexOf("function applyMigrations(");
    expect(at, "applyMigrations не найдена").toBeGreaterThan(0);
    const body = HARNESS.slice(at, HARNESS.indexOf("\n}", at));
    expect(body, "падение миграции снова летит наверх как есть").toContain("brief(");
  });
});
