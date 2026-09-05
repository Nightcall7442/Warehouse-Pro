import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Выплаты: кому и когда отдали деньги.
 *
 * Экран зарплат считал НАЧИСЛЕННОЕ — сколько человеку причитается за период.
 * Выдачи система не знала вовсе: учёт вёлся на стороне, и спор «мне за март не
 * платили» разрешать было нечем. Ни у одной суммы не было даты, номера и того,
 * кто её выдал.
 *
 * Аванс — та же выдача, отличается лишь тем, что происходит до конца периода:
 * остаток к выплате он уменьшает ровно так же. Поэтому это вид записи, а не
 * вторая таблица со своей арифметикой, которая рано или поздно разойдётся с
 * первой.
 */
const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8");
const SCHEMA = read("db/schema.ts");
const KPI = read("api/kpi-router.ts");
const KPI_SERVICE = read("api/services/kpi.ts");
const PAGE = read("src/pages/Salaries.tsx");

/*
  Срез одной процедуры — с проверкой, что оба маркера нашлись.

  Без неё промах маркера даёт indexOf === -1, срез разворачивается почти на
  весь файл, и проверки вроде «сверяет организацию» проходят вхолостую на
  чужом коде. Один раз так и вышло: маркер содержал \n, а файл — CRLF.
*/
const proc = (name: string, next: string) => {
  const from = KPI.indexOf(name);
  const to = KPI.indexOf(next);
  expect(from, `не найдено: ${name}`).toBeGreaterThan(0);
  expect(to, `не найдено: ${next}`).toBeGreaterThan(from);
  return KPI.slice(from, to);
};
const RECORD_PAYOUT = proc("recordPayout: adminQuery", "setSalary: adminQuery");
const SET_SALARY = proc("setSalary: adminQuery", "/** Дата в виде");

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
    expect(KPI).toContain("setSalary: adminQuery");
  });

  it("получатель проверяется по организации", () => {
    /*
      Внешний ключ этого не ловит: users общая на все организации, и без
      проверки руководитель одной мог бы записать выдачу человеку из другой.
    */
    for (const [name, body] of [["выдача", RECORD_PAYOUT], ["оклад", SET_SALARY]] as const) {
      expect(body, `${name}: получателя не сверяют с организацией`).toContain("eq(users.tenantId, ctx.tenant.id)");
      expect(body, `${name}: чужой сотрудник проходит молча`).toContain("Сотрудник не найден в вашей организации");
    }
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
    // Не просто «слово встречается»: вызов должен стоять отдельной строкой на
    // общем пути, а не под условием, которое его иногда пропускает.
    expect(RECORD_PAYOUT, "выдача проходит без следа").toMatch(/\n {6}await recordAudit\(db, \{/);
    expect(RECORD_PAYOUT, "аванс и выплата неразличимы в журнале").toContain('"salary.advance"');
  });

  it("смена оклада тоже", () => {
    // Оклад — тоже деньги: кто и когда его поднял, должно быть видно.
    expect(SET_SALARY).toMatch(/\n {6}await recordAudit\(db, \{/);
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

describe("оклад", () => {
  it("ставится с текущего месяца, а не в открытый на экране период", () => {
    /*
      Экран умеет листать назад. Если бы оклад записывался в показанный
      период, правка в августе переписала бы то, по чему уже выплатили.
    */
    expect(SET_SALARY).toContain("const monthStart = ymd(new Date(now.getFullYear(), now.getMonth(), 1));");
    expect(SET_SALARY, "месяц ищется не по началу периода").toContain("onDate(salesTargets.periodStart, monthStart)");
  });

  it("расчёт берёт оклад и ставку, действовавшие в показанном периоде", () => {
    /*
      Без ограничения по дате поднятая сегодня ставка задним числом делала
      дороже все закрытые месяцы, и август переставал сходиться с тем, что по
      нему выплатили.
    */
    expect(KPI_SERVICE).toContain("untilDate(commissions.periodStart, effectiveOn)");
    expect(KPI_SERVICE).toContain("untilDate(salesTargets.periodStart, effectiveOn)");
  });
});

describe("экран зарплат", () => {
  it("показывает начисленное, выданное и остаток", () => {
    // Одного фонда мало: директор смотрит сюда, чтобы понять, кому ещё
    // предстоит отдать, а не только сколько всего начислено.
    expect(PAGE).toContain("ФОНД ОПЛАТЫ");
    expect(PAGE).toContain("ВЫПЛАЧЕНО");
    expect(PAGE).toContain("К ВЫПЛАТЕ");
    expect(PAGE).toContain("АВАНСЫ");
  });

  it("остаток считается по каждому и не уходит в минус в фонде", () => {
    // Переплата одному не закрывает долг перед другим: вычесть её из общего
    // числа значило бы показать меньше, чем предстоит раздать.
    const at = PAGE.indexOf("const due = allRows.reduce(");
    expect(at, "остаток по фонду не считается").toBeGreaterThan(0);
    expect(PAGE.slice(at, at + 260)).toContain("Math.max(0,");
  });

  it("аванс выдаётся с того же экрана", () => {
    expect(PAGE).toContain('(["payout", "advance"] as const)');
    expect(PAGE).toContain("Аванс");
  });

  it("закрытый месяц можно открыть", () => {
    // Зарплату за сентябрь выдают в октябре: без листания назад экран
    // показывал бы только незакрытый текущий месяц.
    expect(PAGE, "нет шага назад по периодам").toContain("setOffset(o => o + 1)");
    expect(PAGE, "вперёд дальше текущего периода уходить нельзя").toContain("setOffset(o => Math.max(0, o - 1))");
    // Оба запроса — и начисления, и выплаты. Если сдвиг уйдёт только в один,
    // экран покажет август рядом с сентябрьскими выплатами.
    const asked = PAGE.match(/\{ period, offset \}/g) ?? [];
    expect(asked.length, "сдвиг уходит не во все запросы периода").toBeGreaterThanOrEqual(2);
  });

  it("у выплаты есть номер и её детали открываются", () => {
    // «Нет номера — нет разговора»: спор о выплате начинается с того, что её
    // надо назвать и открыть.
    expect(PAGE).toContain("const payoutNo =");
    expect(PAGE).toContain("padStart(6");
    expect(PAGE, "детали выплаты не открываются").toContain("<PayoutDetail");
    expect(PAGE, "ордер нельзя распечатать").toContain("printElement(id,");
  });

  it("шапка и подписи ордера прячутся классом, а не инлайновым стилем", () => {
    /*
      Печать копирует innerHTML в отдельное окно со своей таблицей стилей.
      Инлайновый display:none уехал бы вместе с разметкой, и на бумаге не было
      бы ни заголовка, ни строк для подписей — то есть ордер перестал бы быть
      документом, оставшись выпиской.
    */
    const body = PAGE.slice(PAGE.indexOf("function PayoutDetail"));
    expect(body).toContain('className="signature-block hidden"');
    expect(body, "печатная часть спрятана инлайново").not.toMatch(/signature-block[^\n]*display: "none"/);
  });

  it("оклад задаётся здесь же", () => {
    // Раньше пустой оклад показывался строкой «оклад не задан», а куда идти
    // дальше, экран не говорил.
    expect(PAGE).toContain("оклад не задан");
    expect(PAGE).toContain("trpc.kpi.setSalary.useMutation");
    expect(PAGE).toContain("<SalaryModal");
  });

  it("история выдач видна на карточке человека", () => {
    // Вопрос «когда отдали» возникает ровно там, где стоит сумма, — уводить
    // за ним на отдельный экран незачем.
    expect(PAGE).toContain("paid.entries.map");
    expect(PAGE, "в истории не видно даты").toContain("format(asDate(p.paidAt)");
  });

  it("ведомость выгружается", () => {
    expect(PAGE).toContain("exportToExcel(");
  });
});
