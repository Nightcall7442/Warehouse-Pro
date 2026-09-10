import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { kpiScoreOf } from "../services/kpi";

/**
 * KPI агентов: список и карточка должны считать одно и то же.
 *
 * Разбор нашёл три расхождения, каждое из которых человек видит глазами:
 *
 *   1. Балл. В карточке из состава вычитался штраф за подозрительные визиты, в
 *      списке — нет. Один и тот же агент имел два разных балла, и обе цифры
 *      назывались «Балл».
 *   2. Выручка. Карточка вычитала завершённые возвраты, список — нет. Тот же
 *      класс беды уже ловили с мягко удалёнными заказами.
 *   3. Цель. Кольцо «Цель» брало ПЕРВУЮ попавшуюся строку планов — любого типа
 *      (дневного, недельного) и любого месяца. Выручка за месяц сравнивалась,
 *      например, с дневным планом, и проценты выходили любые.
 *
 * Плюс имя агента читалось без фильтра по организации.
 */
const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const KPI = read("api/services/kpi.ts");

/** Тело функции — от её начала до начала следующей верхнеуровневой. */
const bodyOf = (name: string) => {
  const at = KPI.indexOf(name);
  expect(at, `${name} не найдено`).toBeGreaterThan(0);
  const next = KPI.indexOf("\nexport async function ", at + name.length);
  return KPI.slice(at, next > 0 ? next : undefined);
};

describe("балл считается одной формулой", () => {
  it("штраф за фрод вычитается", () => {
    const metrics = { visitCompletion: 100, revenue: 10_000_000, conversion: 100, returnRate: 100, debtCollection: 100 };
    expect(kpiScoreOf(metrics, 0)).toBe(100);
    // 0.3 балла за каждый процент подозрительных визитов.
    expect(kpiScoreOf(metrics, 50)).toBe(85);
  });

  it("ниже нуля балл не уходит", () => {
    // Иначе агент с нулевой работой и полным фродом получал бы отрицательное
    // число, а грейд считается от неотрицательного.
    expect(kpiScoreOf({ visitCompletion: 0, revenue: 0, conversion: 0, returnRate: 0, debtCollection: 0 }, 100)).toBe(0);
  });

  it("состав взвешен, а не сложен", () => {
    // Полные визиты при пустых продажах — это 30 баллов, а не 100.
    const onlyVisits = kpiScoreOf({ visitCompletion: 100, revenue: 0, conversion: 0, returnRate: 0, debtCollection: 0 }, 0);
    expect(onlyVisits).toBe(30);
  });

  it("и список, и карточка зовут её, а не считают сами", () => {
    /*
      Главное здесь. Пока формула стояла в двух местах, штраф добавили только в
      одно — и никто этого не заметил, потому что оба числа выглядят
      правдоподобно.
    */
    for (const fn of ["export async function calculateAgentKpi", "export async function getAgentList"]) {
      const body = bodyOf(fn);
      expect(body, `${fn}: балл считается на месте`).not.toContain("calculateCompositeScore({");
      expect(body, `${fn}: балл считается не общей функцией`).toContain("kpiScoreOf({");
    }
  });
});

describe("выручка в списке и в карточке", () => {
  const MONEY_FUNCTIONS = [
    "export async function calculateAgentKpi",
    "export async function getAgentList",
    "export async function calculateSalary",
  ];

  it("возвраты берутся общим правилом, а не своим запросом", () => {
    /*
      Свой запрос был у каждой из трёх функций, и все три отбирали по-разному:
      по дате ЗАКАЗА, без фильтра статуса, а счёт возвратов — ещё и по дате
      возврата с другим агентом. Правило одно (services/revenue-returns.ts):
      по дате проведения и только против заказов, которые сами считаются
      выручкой.
    */
    for (const fn of MONEY_FUNCTIONS) {
      const body = bodyOf(fn);
      expect(body, `${fn}: возвраты не учитываются`).toContain("returnsInPeriod(");
      expect(body, `${fn}: вернулся свой запрос по таблице возвратов`)
        .not.toContain("from(returns)");
    }
  });

  it("сумма и счёт выводятся из ОДНОГО набора строк", () => {
    /*
      Числитель и знаменатель доли возвратов входят в один балл KPI. Пока это
      были два запроса, они жили в разных периодах: сумма — по дате заказа,
      счёт — по дате возврата. Балл считался с выручки одного месяца и доли
      другого.
    */
    for (const fn of ["export async function calculateAgentKpi", "export async function getAgentList"]) {
      const body = bodyOf(fn);
      const usesAmount = /\.amount\b/.test(body);
      const usesCount = /\.count\b/.test(body);
      expect(usesAmount, `${fn}: сумма возвратов не вычитается`).toBe(true);
      expect(usesCount, `${fn}: счёт возвратов взят не из того же набора`).toBe(true);
    }
  });
});

describe("цель", () => {
  it("берётся месячная и действовавшая в этом периоде", () => {
    /*
      Правило то же, что у оклада: последний месячный план, начавшийся не позже
      конца показанного периода. Иначе кольцо «Цель» показывает проценты от
      случайного плана.
    */
    const body = bodyOf("export async function calculateAgentKpi");
    const at = body.indexOf("targetAmount: sql<string>");
    expect(at, "выборка цели не найдена").toBeGreaterThan(0);
    /*
      До конца ЭТОГО запроса, а не «ещё 500 знаков»: следом идут соседние
      чтения со своими ограничителями, и по окну страж находил чужой limit
      вместо пропавшего. Ровно так молчал такой же страж в salary-payouts —
      проверено сломом.
    */
    const query = body.slice(at, body.indexOf(";", at) + 1);
    expect(query, "тип периода не отобран").toContain('eq(salesTargets.periodType, "monthly")');
    expect(query, "берётся план и из будущих месяцев").toContain("untilDate(salesTargets.periodStart");
    expect(query, "порядок не задан — строка случайная").toContain("orderBy(desc(salesTargets.periodStart))");
    // Без ограничителя берётся [0] из всех строк за всю историю, и порядок
    // решает случай — то есть строка снова становится произвольной.
    expect(query, "строк берётся больше одной").toContain(".limit(1)");
  });
});

describe("чужая организация", () => {
  it("имя агента читается только из своей", () => {
    // Числа приходили нулями (их запросы организацию проверяют), а имя —
    // настоящее: по чужому agentId можно было узнать сотрудника другого тенанта.
    const body = bodyOf("export async function calculateAgentKpi");
    expect(body).toContain("and(eq(users.id, agentId), eq(users.tenantId, tenantId))");
  });
});
