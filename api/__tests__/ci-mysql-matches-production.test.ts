/**
 * Проверки идут на той же мажорной версии MySQL, что и бой, — и заранее на
 * той, куда бой переезжает.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * В CI, compose и документации стояла MySQL 8, а боевая база на Railway —
 * образ mysql:9.4 (снято с панели 11.09.2026). Проверки с настоящей базой,
 * накат миграций с нуля и сквозные сценарии подтверждали поведение не той
 * версии, что обслуживает клиентов: разница в SQL-режимах, в удалённых
 * возможностях 9.x (mysql_native_password) и в планировщике запросов
 * осталась бы невидимой до боя.
 *
 * 29.09.2026: 9.4 больше не получает исправлений безопасности, бой переедет
 * на 9.7 LTS обновлением на месте. Проверки с базой (задание real-db) теперь
 * идут матрицей на обеих версиях. Матрица принесла свою ловушку: защита
 * ветки main требует проверку с именем ровно «real-db», а GitHub называет
 * задания матрицы «real-db (9.4)». Без явного имени каждый PR ждал бы
 * навсегда проверку, которая не придёт.
 *
 * И вторую: у службы в Railway включён «Wait for CI», а он смотрит на итог
 * всего потока CI, не на список обязательных проверок. Упавшая 9.7 делала
 * весь поток красным, и Railway пропускал выкладку: «не обязательная»
 * проверка на будущей версии держала бы бой на 9.4 без выкладок, даже
 * срочных. Теперь у ветви 9.7 continue-on-error — задание красное, поток нет.
 *
 * 30.09.2026 бой обновлён до 9.7 LTS (9.4 → 9.7.2 на месте, простой около
 * 10 секунд). Матрицу сняли: проверка на старой версии больше ничего не
 * защищает, а на будущей пока ничего нет. Когда бой снова будет переезжать —
 * вернуть матрицу, как в PR #139, вместе с её стражами из истории этого файла.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * 1. Каждый образ базы во всех заданиях и в compose — боевой, записан
 *    словами, без подстановок.
 * 2. Задание real-db называется ровно «real-db» (его требует защита ветки
 *    main), гоняет npm run test:db и не глушит своё падение: упавшая боевая
 *    база обязана держать и слияние, и выкладку.
 *
 * Версия — константа ниже. Когда бой обновят, поменять её здесь, и проверка
 * назовёт все места, которые за ней не успели.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Мажор.минор боевой базы (Railway → MySQL-avuz → Settings → Source Image). */
const PRODUCTION_MYSQL = "mysql:9.7";
/** Имя проверки, которое требует защита ветки main (Settings → Branches). */
const REQUIRED_CHECK = "real-db";

const read = (file: string) => readFileSync(resolve(__dirname, "../..", file), "utf-8");

/** Все значения `image:` в файле, как записаны. */
function imagesIn(src: string): string[] {
  return [...src.matchAll(/^\s*image:\s*(\S.*?)\s*$/gm)].map(m => m[1]);
}

/**
 * Текст одного задания из ci.yml: от «  имя:» до следующего задания.
 * Задания — ключи с отступом в два пробела; комментарии и вложенные ключи
 * начинаются иначе.
 */
function jobBlock(ci: string, job: string): string {
  const lines = ci.split(/\r?\n/);
  const start = lines.findIndex(l => l === `  ${job}:`);
  expect(start, `задание ${job} не найдено в ci.yml`).toBeGreaterThanOrEqual(0);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}[a-z][\w-]*:\s*$/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start, end).join("\n");
}

describe("образ MySQL в проверках", () => {
  const files = [
    ".github/workflows/ci.yml",
    ".github/workflows/test-migrations.yml",
    ".github/workflows/load-test.yml",
    ".github/workflows/screenshots.yml",
    "docker-compose.yml",
  ];
  for (const file of files) {
    it(`${file}: образ, записанный словами, — ${PRODUCTION_MYSQL}`, () => {
      const images = imagesIn(read(file));
      expect(images.length, "объявление образа не найдено").toBeGreaterThan(0);
      for (const img of images) {
        expect(img, `${file}: база не боевой версии`).toBe(PRODUCTION_MYSQL);
      }
    });
  }
});

describe("проверки с базой идут на боевой версии", () => {
  const block = jobBlock(read(".github/workflows/ci.yml"), REQUIRED_CHECK);

  it("задание даёт обязательную проверку «real-db» и гоняет test:db", () => {
    // Без name GitHub называет задание по ключу — ровно «real-db». Имя из
    // подстановки (как у матрицы) дало бы другое, и PR ждали бы навсегда.
    expect(block, "имя задания не должно браться из подстановки").not.toMatch(/^ {4}name:/m);
    expect(block, "матрица вернулась — верните и её стражи (PR #139)").not.toContain("matrix");
    expect(block).toContain(`image: ${PRODUCTION_MYSQL}`);
    expect(block).toContain("npm run test:db");
  });

  it("упавшая боевая база держит выкладку", () => {
    // «Wait for CI» в Railway смотрит на итог всего потока: continue-on-error
    // сделал бы поток зелёным при красной боевой базе.
    expect(block, "continue-on-error у боевой базы пропустит сломанную выкладку").not.toContain("continue-on-error");
  });
});
