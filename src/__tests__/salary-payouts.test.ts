import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Выплаты: кому и когда отдали деньги.
 *
 * Экран зарплат считал НАЧИСЛЕННОЕ — сколько человеку причитается за период.
 * Выдачи система не знала вовсе: учёт вёлся на стороне, и спор «мне за март не
 * платили» разрешать было нечем. Ни у одной суммы не было даты, и не было
 * того, кто её выдал.
 *
 * Аванс — та же выдача, отличается лишь тем, что происходит до конца периода:
 * остаток к выплате он уменьшает ровно так же. Поэтому это вид записи, а не
 * вторая таблица со своей арифметикой, которая рано или поздно разойдётся с
 * первой.
 */
const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8");
const SCHEMA = read("db/schema.ts");
const KPI = read("api/kpi-router.ts");
const PAGE = read("src/pages/Salaries.tsx");

const proc = (name: string, next: string) => KPI.slice(KPI.indexOf(name), KPI.indexOf(next));

describe("запись о выдаче", () => {
  it("хранит кому, сколько, когда и от кого", () => {
    const at = SCHEMA.indexOf('mysqlTable("salary_payouts"');
    expect(at, "таблицы выплат нет").toBeGreaterThan(0);
    const table = SCHEMA.slice(at, SCHEMA.indexOf("}));", at));
    expect(table, "неизвестно, кому выдали").toContain('bigint("user_id"');
    expect(table, "неизвестно, сколько").toContain('decimal("amount"');
    expect(table, "дата выдачи не проставляется сама").toMatch(/timestamp\("paid_at"\)\.defaultNow\(\)\.notNull\(\)/);
    // Кто выдал — обязательное поле: у каждой суммы должен быть человек,
    // иначе журнал не отвечает на главный вопрос спора.
    expect(table, "неизвестно, кто выдал").toMatch(/bigint\("created_by".*\.notNull\(\)/);
  });

  it("аванс — вид записи, а не отдельная таблица", () => {
    const at = SCHEMA.indexOf('mysqlTable("salary_payouts"');
    expect(SCHEMA.slice(at, SCHEMA.indexOf("}));", at)))
      .toContain('mysqlEnum("kind", ["payout", "advance"])');
    expect(SCHEMA, "у авансов завелась своя таблица — суммы разойдутся")
      .not.toContain('mysqlTable("salary_advances"');
  });
});

describe("кто может выдавать", () => {
  it("список выплат и сама выдача — только руководителю", () => {
    // Это деньги всей команды: оператору хватает своих чисел, и открывать ему
    // чужие оклады должно быть отдельным решением, а не побочным эффектом.
    expect(KPI).toContain("payouts: financeQuery");
    expect(KPI).toContain("recordPayout: adminQuery");
  });

  it("получатель проверяется по организации", () => {
    /*
      Внешний ключ этого не ловит: users общая на все организации, и без
      проверки руководитель одной мог бы записать выдачу человеку из другой.
    */
    const body = proc("recordPayout: adminQuery", "      return { id: Number(result.insertId) };");
    expect(body, "получателя не сверяют с организацией").toContain("eq(users.tenantId, ctx.tenant.id)");
    expect(body, "чужой сотрудник проходит молча").toContain("Сотрудник не найден в вашей организации");
  });

  it("список сужен организацией и периодом", () => {
    const body = proc("payouts: financeQuery", "recordPayout: adminQuery");
    expect(body).toContain("eq(salaryPayouts.tenantId, ctx.tenant.id)");
    expect(body).toContain("gte(salaryPayouts.paidAt, periodStart)");
    expect(body).toContain("lte(salaryPayouts.paidAt, periodEnd)");
  });
});

describe("след выдачи", () => {
  it("каждая выдача пишется в журнал", () => {
    const body = proc("recordPayout: adminQuery", "      return { id: Number(result.insertId) };");
    // Не просто «слово встречается»: вызов должен стоять отдельной строкой на
    // общем пути, а не под условием, которое его иногда пропускает.
    expect(body, "выдача проходит без следа").toMatch(/\n {6}await recordAudit\(db, \{/);
    expect(body, "аванс и выплата неразличимы в журнале").toContain('"salary.advance"');
  });

  it("изменить или удалить выдачу нечем", () => {
    /*
      Вся ценность журнала держится на том, что записи только добавляются.
      Ошибочную выдачу гасят встречной записью с минусом — поэтому на экране
      отрицательная сумма разрешена, — а не подчисткой задним числом.
    */
    const dir = path.resolve(process.cwd(), "api");
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith(".ts"))) {
      const src = read(`api/${f}`);
      expect(src, `появилось удаление выплат в ${f}`).not.toMatch(/delete\(salaryPayouts\)/);
      expect(src, `появилось изменение выплат в ${f}`).not.toMatch(/update\(salaryPayouts\)/);
    }
  });
});

describe("экран зарплат", () => {
  it("показывает начисленное, выданное и остаток", () => {
    // Одного фонда мало: директор смотрит сюда, чтобы понять, кому ещё
    // предстоит отдать, а не только сколько всего начислено.
    expect(PAGE).toContain("ФОНД ОПЛАТЫ");
    expect(PAGE).toContain("ВЫПЛАЧЕНО");
    expect(PAGE).toContain("К ВЫПЛАТЕ");
  });

  it("остаток считается по каждому и не уходит в минус в фонде", () => {
    // Переплата одному не закрывает долг перед другим: вычесть её из общего
    // числа значило бы показать меньше, чем предстоит раздать.
    const at = PAGE.indexOf("const due = rows.reduce(");
    expect(at, "остаток по фонду не считается").toBeGreaterThan(0);
    expect(PAGE.slice(at, at + 260)).toContain("Math.max(0,");
  });

  it("аванс выдаётся с того же экрана", () => {
    expect(PAGE).toContain('(["payout", "advance"] as const)');
    expect(PAGE).toContain("Аванс");
  });

  it("история выдач видна на карточке человека", () => {
    // Вопрос «когда отдали» возникает ровно там, где стоит сумма, — уводить
    // за ним на отдельный экран незачем.
    expect(PAGE).toContain("paid.entries.map");
    expect(PAGE, "в истории не видно даты").toContain('format(asDate(p.paidAt)');
  });
});
