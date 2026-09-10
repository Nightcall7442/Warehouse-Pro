import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Обед и дорожные, зарплата в прибыли, подтверждение получения.
 *
 * ── Три жалобы одного арендатора ────────────────────────────────────────────
 *
 *   1. «Доставщики берут деньги на обед и дорожные — они тоже должны
 *      считаться». Эти деньги выдавались наличными в течение месяца и не
 *      попадали никуда: ни в зарплату курьера, ни в расходы организации. В
 *      конце месяца ему платили полный расчёт СВЕРХ уже выданного.
 *
 *   2. «Зарплаты не считаются в P&L». Расходами считались только сопутствующие
 *      траты по приходам; фонд оплаты труда в прибыль не входил вовсе — то
 *      есть у организации, где зарплата вторая по величине статья, «прибыль»
 *      означала не то, что человек читал.
 *
 *   3. «Сотрудник получает уведомление и подтверждение о получении». Выплата
 *      была событием в одну сторону: записали, что выдали, — а другой стороны
 *      у записи не было.
 */
const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const KPI_SERVICE = read("api/services/kpi.ts");
const KPI_ROUTER = read("api/kpi-router.ts");
const ANALYTICS = read("api/analytics-router.ts");
const COMMISSION = read("api/commission-router.ts");
const SCHEMA = read("db/schema.ts");

const salaryBody = KPI_SERVICE.slice(
  KPI_SERVICE.indexOf("export async function calculateSalary"),
  KPI_SERVICE.indexOf("\nfunction calculateCompositeScore"),
);

describe("обед и дорожные", () => {
  it("считаются по РАБОЧИМ ДНЯМ, а не по числу доставок", () => {
    /*
      Пять доставок за один день — это один обед, а не пять. Считай мы
      заказами, курьер с плотным маршрутом получал бы обедов вдвое больше, чем
      было дней в месяце.
    */
    const at = KPI_SERVICE.indexOf("workDays: sql<number>");
    expect(at, "рабочие дни не считаются вовсе").toBeGreaterThan(0);
    const expr = KPI_SERVICE.slice(at, KPI_SERVICE.indexOf("\n", at));
    expect(expr, "рабочие дни считаются заказами").toContain("COUNT(DISTINCT");
    expect(expr, "день берётся не по дате доставки").toContain("DATE(COALESCE(");
    // Только довезённые: день, в который курьер ничего не довёз, следа выхода
    // на работу не оставляет, и платить за него не за что.
    expect(expr).toContain("= 'delivered'");
  });

  it("одна ставка на день, и обе складываются", () => {
    expect(salaryBody).toContain("(mealAllowance + travelAllowance) * workDays");
  });

  it("входят в итог курьера", () => {
    /*
      Без этого суммы считались бы и показывались, но на руки человек получал
      бы прежнее: ровно та беда, с которой всё началось, только теперь ещё и с
      числом на экране, которому нельзя верить.
    */
    const total = salaryBody.slice(salaryBody.indexOf("const totalSalary"), salaryBody.indexOf("return {"));
    expect(total, "суточные не дошли до выплаты").toContain("deliveryPay + allowancePay");
  });

  it("не достаются агенту", () => {
    // Обед и дорожные — курьерская статья: у агента нет ни маршрута, ни
    // рабочих дней в этом смысле, и слагаемое молча удвоило бы ему выплату.
    const total = salaryBody.slice(salaryBody.indexOf("const totalSalary"), salaryBody.indexOf("return {"));
    const agentBranch = total.slice(total.indexOf(":") + 1);
    expect(agentBranch, "агенту начислили суточные").not.toContain("allowancePay");
  });

  it("считаются и без ставки за доставку", () => {
    /*
      Ловушка, на которой это ломалось: статистика курьера запрашивалась только
      при ненулевой ставке за доставку. Курьер на голом окладе, которому
      оплачивают лишь обед и проезд, получал бы ноль рабочих дней и ноль
      суточных — то есть настройка молча ничего не делала.
    */
    const at = salaryBody.indexOf("const courier =");
    const cond = salaryBody.slice(at, salaryBody.indexOf("\n\n", at));
    expect(cond).toContain("mealAllowance > 0");
    expect(cond).toContain("travelAllowance > 0");
  });

  it("ставки за день лежат там же, где остальные ставки человека", () => {
    // Не в отдельной таблице: строка commissions и означает «как человеку
    // считают переменную часть в этом периоде».
    expect(SCHEMA).toContain('mealAllowance:   decimal("meal_allowance"');
    expect(SCHEMA).toContain('travelAllowance: decimal("travel_allowance"');
  });

  it("не переданные ставки не обнуляются", () => {
    /*
      Экран процентов агента ничего не знает про обед курьера и не должен
      стирать его, просто сохранив соседнее поле. Это же правило уже стоит на
      deliveryRate и courierPayMode — здесь оно распространено на суточные.
    */
    for (const field of ["mealAllowance", "travelAllowance"]) {
      expect(COMMISSION, `${field} обнуляется, когда его не передали`)
        .toContain(`input.${field} === undefined ? {} :`);
    }
  });
});

describe("зарплата в прибыли", () => {
  const pnl = ANALYTICS.slice(ANALYTICS.indexOf("  pnl: financeQuery"), ANALYTICS.indexOf("      const current = await calcPeriod"));

  it("фонд оплаты труда входит в расходы", () => {
    expect(pnl, "зарплата снова не считается в прибыли")
      .toContain("const operatingExpenses = purchaseExpenses + payrollExpenses;");
  });

  it("берётся ВЫДАННОЕ, а не начисленное", () => {
    /*
      Начисление — намерение: оно пересчитывается при каждом открытии экрана
      зарплат, меняется вместе с продажами и возвратами и до конца месяца не
      является числом вовсе. Прибыль периода считается по фактам.
    */
    expect(pnl).toContain("from(salaryPayouts)");
    expect(pnl, "прибыль считает начисленное").not.toContain("calculateSalary");
  });

  it("по дате выдачи, а не по периоду начисления", () => {
    // Деньги ушли из кассы в этот день — тем же правилом, что и приходы рядом.
    // Именно поэтому аванс попадает в свой месяц, а не в тот, за который выдан.
    const at = pnl.indexOf("const payrollRow");
    const q = pnl.slice(at, pnl.indexOf("));", at));
    const bounds = [...q.matchAll(/sql`\$\{salaryPayouts\.(\w+)\}\s*([<>]=)/g)].map(m => [m[1], m[2]]);
    expect(bounds, "границы периода выплат не найдены").toHaveLength(2);
    expect(bounds.map(b => b[0])).toEqual(["paidAt", "paidAt"]);
    // Верхняя граница — до конца дня: даты приходят полночью, и без этого
    // выплаты последнего дня периода выпадали бы из расходов.
    expect(q).toContain('dateTo + " 23:59:59"');
  });

  it("считается только своя организация", () => {
    const at = pnl.indexOf("const payrollRow");
    const q = pnl.slice(at, pnl.indexOf("));", at));
    expect(q, "в расходы попал чужой фонд оплаты").toContain("eq(salaryPayouts.tenantId, tid)");
  });

  it("экран называет расходы честно", () => {
    /*
      Карточка звалась «РАСХОДЫ НА ДОСТАВКУ», и с приходом зарплаты это
      перестало быть правдой. Подпись, называющая половину содержимого, хуже
      отсутствия подписи: человек читает её как полную и считает по ней.
    */
    const CARDS = read("src/components/pnl/PnLSummaryCards.tsx");
    // Именно подпись, а не любое упоминание: разбор рядом с правкой называет
    // прежний текст, и запрет на слово вычеркнул бы объяснение вместе с
    // ошибкой.
    expect(CARDS).not.toMatch(/label=\{t\("РАСХОДЫ НА ДОСТАВКУ"/);
    expect(CARDS).toMatch(/label=\{t\("РАСХОДЫ",/);
    // Разбивка тоже: «расходы выросли» без ответа «закупка или зарплата» —
    // это два разных решения, слитых в одно число.
    const HEAD = read("src/components/pnl/PnLHeadline.tsx");
    expect(HEAD).toContain('label: t("Зарплата"');
    expect(HEAD).toContain('label: t("Закупка"');
  });
});

describe("подтверждение получения", () => {
  it("сотруднику уходит уведомление при выдаче", () => {
    const at = KPI_ROUTER.indexOf("  recordPayout:");
    const body = KPI_ROUTER.slice(at, KPI_ROUTER.indexOf("\n  /*", at + 10));
    expect(body, "человек не узнаёт, что деньги выданы").toContain("NotificationService.create(db, {");
    // Аванс и полный расчёт различаются в заголовке: иначе человек читает
    // «выдана зарплата» на авансе и считает месяц закрытым.
    expect(body).toContain('input.kind === "advance" ? "Выдан аванс" : "Выдана зарплата"');
  });

  it("подтвердить можно только СВОЮ выплату", () => {
    /*
      Без условия по человеку любой сотрудник подтверждал бы чужие выплаты, и
      подпись переставала бы что-либо значить — то есть вся затея теряла бы
      смысл, оставаясь на вид работающей.
    */
    const at = KPI_ROUTER.indexOf("  confirmPayout:");
    expect(at, "подтверждения нет вовсе").toBeGreaterThan(0);
    const body = KPI_ROUTER.slice(at, KPI_ROUTER.indexOf("\n  /*", at + 10));
    expect(body).toContain("eq(salaryPayouts.userId, ctx.user.id)");
    expect(body).toContain("eq(salaryPayouts.tenantId, ctx.tenant.id)");
  });

  it("второе нажатие не переписывает время первого", () => {
    // Именно время, а не сам факт, отвечает на вопрос «когда он подтвердил».
    const at = KPI_ROUTER.indexOf("  confirmPayout:");
    const body = KPI_ROUTER.slice(at, KPI_ROUTER.indexOf("\n  /*", at + 10));
    expect(body).toContain("${salaryPayouts.confirmedAt} IS NULL");
  });

  it("свои выплаты человек видит, а чужие — нет", () => {
    /*
      Сколько получает сосед, сотруднику знать незачем: kpi.payouts отдаёт
      выплаты всей команды и открыт только руководителю. А своё он должен
      видеть обязательно — иначе подтверждать нечего.
    */
    const at = KPI_ROUTER.indexOf("  myPayouts:");
    expect(at, "своих выплат человек не видит").toBeGreaterThan(0);
    const body = KPI_ROUTER.slice(at, KPI_ROUTER.indexOf("\n  /*", at + 10));
    expect(body, "список не сужен до самого человека").toContain("eq(salaryPayouts.userId, ctx.user.id)");
    expect(body, "имя получателя лишнее — он и так знает, кто он").not.toContain("users.name");
  });

  it("подтверждение ничего не меняет в деньгах", () => {
    /*
      Деньги ушли из кассы в момент выдачи. Поставь мы расход или остаток к
      выплате в зависимость от того, открыл ли человек телефон, — и прибыль
      организации начала бы зависеть от чужой расторопности.
    */
    expect(ANALYTICS, "прибыль смотрит на подтверждение").not.toContain("confirmedAt");
    const report = KPI_ROUTER.slice(KPI_ROUTER.indexOf("  salaryReport:"), KPI_ROUTER.indexOf("  payouts:"));
    expect(report, "начисление смотрит на подтверждение").not.toContain("confirmedAt");
  });
});
