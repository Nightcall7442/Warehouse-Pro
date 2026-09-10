import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Возврат вычитается один раз, по одному правилу.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Возвраты вычитались из денег в ШЕСТИ местах, и каждое отбирало их по-своему:
 *
 *   прибыль (P&L)          по дате ВОЗВРАТА, только против выручки  ✓
 *   валовая маржа          не вычитались вовсе
 *   комиссия агента        по дате ЗАКАЗА, статус заказа не проверен
 *   выручка в KPI          по дате ЗАКАЗА, статус заказа не проверен
 *   доля возвратов в KPI   по дате ВОЗВРАТА, агент из ДОКУМЕНТА возврата
 *   рейтинг магазина       статус заказа не проверен
 *
 * Человек видел это глазами. Плитка «валовая прибыль» на первом экране и P&L
 * на соседней странице расходились ровно на сумму возвратов. Один и тот же
 * агент имел в карточке одну выручку, в списке другую, а в ведомости третью.
 *
 * Дороже всего был пропущенный отбор по статусу. Заказ, отменённый ПОСЛЕ
 * проведения возврата, выпадал из выручки целиком — и возврат по нему
 * продолжал вычитаться. Те же деньги дважды, причём вычет съедал СОСЕДНИЙ
 * заказ: два заказа по миллиону превращались в ноль продаж, и Math.max(0, …)
 * это прятало.
 *
 * ── Два правила, и это не одно ──────────────────────────────────────────────
 *
 * «Сколько вернулось ЗА ПЕРИОД» — выручка, прибыль, комиссия, KPI. Живёт в
 * services/revenue-returns.ts: по дате проведения, только против заказов,
 * которые сами считаются выручкой.
 *
 * «Сколько вернулось ПО ЭТОМУ ЗАКАЗУ» — долг. Периода нет вовсе. Живёт в
 * services/shop-debt.ts и повторено в двух читающих запросах.
 *
 * Проверки ниже держат оба правила на уровне исходников, потому что беда была
 * не в неверной формуле, а в НОВОМ месте, которое написало свою.
 */

const API_DIR = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(API_DIR, rel.split("/").join(sep)), "utf8").replace(/\r\n/g, "\n");

function* walkTypeScript(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walkTypeScript(full);
    else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) yield full;
  }
}

/** Сумма по колонке возвратов — в любой записи, сырой или через построитель. */
const RETURNS_MONEY_SUM = /SUM\(\s*(?:CAST\(\s*)?(?:\$\{returns\.totalAmount\}|\w+\.total_amount)/i;

/**
 * Кому можно складывать деньги возвратов и почему.
 *
 * Список именной, а не «кроме тестов»: каждое место здесь — осознанное
 * исключение с причиной, и добавить новое можно только дописав строку.
 */
const MAY_SUM_RETURNS: Record<string, string> = {
  "services/revenue-returns.ts":
    "правило периода — то самое, ради которого список и заведён",
  "services/shop-debt.ts":
    "правило долга: по заказу, без периода. Это ДРУГОЙ вопрос, не выручка",
  "order-router.ts":
    "долг по агенту — повторяет правило shop-debt.ts, за этим следит проверка ниже",
  "services/shop-scoring.ts":
    "рейтинг магазина считается одним запросом целиком; отбор сверяется ниже",
  "returns-router.ts":
    "свод по причинам возврата — это отчёт О САМИХ возвратах, а не вычет из денег",
};

describe("деньги возвратов складывают только названные места", () => {
  it("нового своего запроса не появилось", () => {
    const offenders: string[] = [];

    for (const file of walkTypeScript(API_DIR)) {
      const rel = relative(API_DIR, file).split(sep).join("/");
      if (rel in MAY_SUM_RETURNS) continue;
      if (RETURNS_MONEY_SUM.test(readFileSync(file, "utf8"))) offenders.push(rel);
    }

    expect(
      offenders,
      offenders.length === 0 ? "" :
        `Здесь складывают деньги возвратов своим запросом:\n` +
        offenders.map(f => `  - ${f}`).join("\n") +
        `\n\nЗа период — returnsInPeriod() из services/revenue-returns.ts.\n` +
        `По заказу — правило из services/shop-debt.ts.\n` +
        `Свой отбор отличается от общего мелочью и расходится на деньгах: ` +
        `так уже вышло у комиссии, у KPI и у рейтинга магазина.`,
    ).toEqual([]);
  });

  it("исключения выписаны с причиной, а не просто перечислены", () => {
    // Список без причин через полгода превращается в «так исторически».
    for (const [file, why] of Object.entries(MAY_SUM_RETURNS)) {
      expect(why.length, `${file}: причина не написана`).toBeGreaterThan(20);
    }
  });
});

describe("правило периода", () => {
  const HELPER = read("services/revenue-returns.ts");

  it("отбирает по дате ПРОВЕДЕНИЯ возврата, а не заказа", () => {
    /*
      Иначе закрытый месяц менялся бы задним числом каждый раз, когда магазин
      что-то возвращает. Комиссия и KPI брали именно по дате заказа, и один
      возврат уменьшал разные месяцы в разных отчётах.
    */
    const where = HELPER.slice(HELPER.indexOf(".where(and("), HELPER.indexOf("if (rows.length === 0)"));
    expect(where, "период считается не по дате возврата").toContain("${returns.createdAt} >=");
    expect(where, "период считается не по дате возврата").toContain("${returns.createdAt} <=");
    expect(where, "вернулся отбор по дате заказа").not.toContain("orders.createdAt");
  });

  it("вычитает только против заказов, которые сами считаются выручкой", () => {
    // Тот же помощник, что у самой выручки. Похожее, но своё условие — это
    // ровно то, из-за чего возврат по отменённому заказу вычитался дважды.
    expect(HELPER).toContain("revenueOrderConditions(tenantId)");
  });

  it("возврат без заказа в выручку не лезет", () => {
    // innerJoin, а не leftJoin: уменьшать ему нечего, такой возврат живёт
    // только в долге магазина.
    expect(HELPER).toMatch(/\.innerJoin\(orders,\s*eq\(orders\.id,\s*returns\.orderId\)\)/);
  });

  it("все денежные экраны зовут правило, а не пишут своё", () => {
    const CALLERS = [
      "analytics-router.ts",    // P&L, помесячный ряд, разбивка по способу оплаты
      "dashboard-router.ts",    // плитка «валовая прибыль»
      "commission-router.ts",   // база комиссии
      "services/kpi.ts",        // карточка, список, ведомость
    ];
    for (const rel of CALLERS) {
      const src = read(rel);
      expect(src, `${rel}: возвраты не учитываются вовсе`).toContain("returnsInPeriod(");
      expect(src, `${rel}: вернулся свой запрос по таблице возвратов`).not.toContain("from(returns)");
    }
  });
});

describe("правило долга", () => {
  const AGENT_DEBT = read("order-router.ts");
  const SHOP_DEBT = read("services/shop-debt.ts");

  /** Выражение долга в agentSummary — от `debt: sql` до конца шаблона. */
  const agentDebtExpr = (() => {
    const at = AGENT_DEBT.indexOf("debt: sql<string>");
    expect(at, "выражение долга по агенту не найдено").toBeGreaterThan(0);
    return AGENT_DEBT.slice(at, AGENT_DEBT.indexOf("lastOrderAt:", at));
  })();

  it("долг по агенту вычитает возвраты", () => {
    /*
      Их там не было. Магазин вернул половину доставленного заказа: shops.debt
      падал (пересчёт возвраты знает), а колонка «долг» на экране заказов —
      нет. Оператор видел два разных долга по одним и тем же заказам, и
      разница ничем не объяснялась.
    */
    expect(agentDebtExpr, "возвраты в долге агента снова не учитываются")
      .toMatch(/FROM\s+\$\{returns\}\s+r/i);
    expect(agentDebtExpr).toContain("r.status = 'completed'");
  });

  it("условие «заказ ещё должен» то же, что у пересчёта долга магазина", () => {
    /*
      Похожее, но не совпадающее условие в этой системе уже стоило денег.

      Записаны они по-разному — пересчёт сырым SQL (`o.payment_method`), долг
      по агенту через построитель (`${orders.paymentMethod}`), — поэтому
      сверяется СМЫСЛ, а не буква: обе формы допускаются нарочно, иначе
      проверка запрещала бы менять способ записи, ничего не защищая.
    */
    for (const expr of [agentDebtExpr, SHOP_DEBT]) {
      expect(expr).toMatch(/IN\s*\(\s*'cancelled'\s*,\s*'returned'\s*\)/i);
      expect(expr).toMatch(/payment_?[Mm]ethod\}?\s*=\s*'debt'/);
      expect(expr).toMatch(/status\}?\s*=\s*'delivered'/i);
    }
  });

  it("возврат вычитается ВНУТРИ ветки начисления, а не поверх неё", () => {
    /*
      Отменённый заказ даёт ноль: его сумма уже списана целиком. Вычти возврат
      снаружи — и он уедет из ЧУЖИХ заказов того же агента.
    */
    const branch = agentDebtExpr.slice(
      agentDebtExpr.indexOf("WHEN ${orders.paymentMethod}"),
      agentDebtExpr.indexOf("ELSE 0"),
    );
    expect(branch, "вычет возвратов вынесен из ветки начисления").toMatch(/FROM\s+\$\{returns\}/i);
  });

  it("нижняя граница — на всей сумме агента, а не на каждом заказе", () => {
    /*
      Переплаченный и потом возвращённый заказ оставляет магазину право на
      деньги, и это право гасит другие его заказы. Пол на каждом заказе это
      право съедал бы. Ровно так же устроен пересчёт долга магазина: там пол
      стоит на всей сумме магазина.
    */
    expect(agentDebtExpr).toMatch(/GREATEST\(0,\s*COALESCE\(SUM\(/);
    expect(SHOP_DEBT).toMatch(/SET\s+s\.debt\s*=\s*GREATEST\(0,/i);
  });

  it("напоминание о долге считает возвраты погашением", () => {
    /*
      Считалось «сумма заказа минус оплаты». Тот, кто вместо доплаты ВЕРНУЛ
      товар, оставался должен навсегда: shops.debt у него ноль, а директору
      каждый день уходило «ПРОСРОЧЕННЫЙ ДОЛГ» — и в приложение, и в телеграм.

      Числами это меряет debt-reminder-settles.test.ts. Здесь — что вернувшийся
      товар вообще ДОХОДИТ до решения: собрать его и не передать было бы ровно
      той же ошибкой, только незаметнее.
    */
    const src = read("cron/debt-reminders.ts");
    expect(src, "возвраты по заказам не собираются").toContain("returnedByOrder");

    // Ранний выход `if (withOrder.length === 0) return settled;` стоит ВЫШЕ
    // цикла, поэтому конец куска ищется по объявлению правила, а не по первому
    // возврату из функции: иначе срез выходил пустым и проверка проходила,
    // ничего не проверив.
    const call = src.slice(src.indexOf("for (const r of withOrder)"), src.indexOf("export function reminderSettled"));
    expect(call, "возвраты собраны, но в решение не переданы").toContain("returnedByOrder.get(key)");
    expect(call, "оплаты в решение не переданы").toContain("paidByOrder.get(key)");

    const rule = src.slice(src.indexOf("export function reminderSettled"));
    expect(rule, "остаток считается без возвратов").toMatch(/total\)\s*-\s*paid\s*-\s*returned/);
    expect(rule, "правило «заказ ещё должен» подменено своим").toContain("orderStillOwes(order)");
  });
});

describe("рейтинг магазина", () => {
  const SCORING = read("services/shop-scoring.ts");

  it("вычитает возврат только против попавшего в выручку заказа", () => {
    const sub = SCORING.slice(SCORING.indexOf("AS returned"), SCORING.indexOf("GROUP BY r.shop_id"));
    expect(sub, "отбора по заказу нет — возврат по отмене снижает рейтинг дважды")
      .toMatch(/EXISTS\s*\(/i);
    expect(sub).toMatch(/ro\.deleted_at\s+IS\s+NULL/i);
    expect(sub).toMatch(/ro\.status\s*=\s*'delivered'/i);
  });

  it("выручка и вычет отбираются одинаково", () => {
    /*
      Выручка считалась по `status IN ('delivered','completed')`. Значения
      'completed' в enum статусов заказа нет и никогда не было: сравнение молча
      не совпадало ни с чем, но читалось как второй вид выполненного заказа — и
      условие возвратов пришлось бы писать под него же.
    */
    expect(SCORING, "вернулся мёртвый статус 'completed'")
      .not.toMatch(/o\.status\s+IN\s*\(\s*'delivered'\s*,\s*'completed'\s*\)/i);
    expect(SCORING).toMatch(/o\.status\s*=\s*'delivered'/i);
  });
});
