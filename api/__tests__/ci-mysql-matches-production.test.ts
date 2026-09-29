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
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * 1. Каждый образ, записанный словами, во всех заданиях с базой и в compose —
 *    боевой. Подстановка из матрицы допустима только в real-db.
 * 2. Матрица real-db содержит боевую версию под именем «real-db» и следующую
 *    версию под другим именем; обе гоняют npm run test:db.
 * 3. Падение следующей версии не роняет поток (не держит выкладку), падение
 *    боевой — роняет.
 *
 * Версии — две константы ниже. Когда бой обновят, поменять их здесь, и
 * проверка назовёт все места, которые за ними не успели.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Мажор.минор боевой базы (Railway → MySQL-avuz → Settings → Source Image). */
const PRODUCTION_MYSQL = "mysql:9.4";
/** Версия, на которую бой переезжает. Проверки с базой гоняются и на ней. */
const NEXT_MYSQL = "mysql:9.7";
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
        // Подстановку из матрицы разбирает отдельная проверка ниже.
        if (img.includes("${{")) continue;
        expect(img, `${file}: база не боевой версии`).toBe(PRODUCTION_MYSQL);
      }
    });
  }

  it("подстановка версии из матрицы — только в real-db", () => {
    for (const file of files) {
      const src = read(file);
      const templated = imagesIn(src).filter(img => img.includes("${{"));
      if (file !== ".github/workflows/ci.yml") {
        expect(templated, `${file}: версия базы должна быть боевой, без матрицы`).toEqual([]);
        continue;
      }
      // В ci.yml подстановка ровно одна — и та внутри real-db.
      expect(templated).toEqual(["mysql:${{ matrix.mysql }}"]);
      expect(jobBlock(src, "real-db")).toContain("image: mysql:${{ matrix.mysql }}");
    }
  });
});

/**
 * Ветви матрицы real-db: каждая «- mysql: "…"» со своими ключами. Ключ
 * относится к ветви, пока отступ глубже её дефиса.
 */
function matrixLegs(block: string) {
  const legs: { image: string; check?: string; optional?: string }[] = [];
  let indent = -1;
  for (const line of block.split(/\r?\n/)) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    const start = line.match(/^(\s*)-\s*mysql:\s*"([^"]+)"\s*$/);
    if (start) {
      indent = start[1].length;
      legs.push({ image: `mysql:${start[2]}` });
      continue;
    }
    const kv = line.match(/^(\s*)([\w-]+):\s*(.+?)\s*$/);
    if (indent >= 0 && kv && kv[1].length > indent) {
      const leg = legs[legs.length - 1];
      if (kv[2] === "check") leg.check = kv[3];
      if (kv[2] === "optional") leg.optional = kv[3];
    } else {
      indent = -1;
    }
  }
  return legs;
}

describe("проверки с базой идут на боевой версии и на следующей", () => {
  const block = jobBlock(read(".github/workflows/ci.yml"), "real-db");
  const legs = matrixLegs(block);

  it("боевая версия отвечает за обязательную проверку «real-db»", () => {
    expect(block, "имя задания не взято из матрицы — GitHub назовёт его «real-db (9.4)»")
      .toContain("name: ${{ matrix.check }}");
    const required = legs.filter(l => l.check === REQUIRED_CHECK);
    expect(required, "обязательную проверку должна давать ровно одна ветвь матрицы").toHaveLength(1);
    expect(required[0].image, "обязательная проверка идёт не на боевой базе").toBe(PRODUCTION_MYSQL);
  });

  it(`и рядом — ${NEXT_MYSQL} под своим именем`, () => {
    const next = legs.find(l => l.image === NEXT_MYSQL);
    expect(next, `в матрице real-db нет ${NEXT_MYSQL}`).toBeDefined();
    expect(next!.check).not.toBe(REQUIRED_CHECK);
    expect(legs.map(l => l.image).sort()).toEqual([NEXT_MYSQL, PRODUCTION_MYSQL].sort());
  });

  it("одна упавшая версия не обрывает другую, обе гоняют test:db", () => {
    expect(block).toContain("fail-fast: false");
    expect(block).toContain("npm run test:db");
  });

  it("упавшая следующая версия не держит выкладку, упавшая боевая — держит", () => {
    // «Wait for CI» в Railway смотрит на итог всего потока. Задание без
    // continue-on-error, упав, делает поток красным — выкладка пропускается.
    // Именно на уровне задания: на шаге оно сделало бы задание зелёным, и
    // красную 9.7 не увидел бы никто.
    expect(block, `без continue-on-error упавшая ${NEXT_MYSQL} остановит выкладку боя`)
      .toMatch(/^ {4}continue-on-error: \$\{\{ matrix\.optional \}\}\s*$/m);
    expect(block.match(/continue-on-error:/g), "continue-on-error на шаге спрячет красную ветвь")
      .toHaveLength(1);
    const required = legs.find(l => l.check === REQUIRED_CHECK);
    const next = legs.find(l => l.image === NEXT_MYSQL);
    expect(required?.optional, "падение боевой версии обязано держать выкладку").toBe("false");
    expect(next?.optional, `падение ${NEXT_MYSQL} не должно держать выкладку`).toBe("true");
  });
});
