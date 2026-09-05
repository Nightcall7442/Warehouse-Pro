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
  it("обе за вычетом завершённых возвратов", () => {
    for (const fn of ["export async function calculateAgentKpi", "export async function getAgentList"]) {
      const body = bodyOf(fn);
      expect(body, `${fn}: возвраты не учитываются`).toContain('eq(returns.status, "completed")');
    }
    expect(bodyOf("export async function getAgentList"), "в списке возвраты не вычитаются из выручки")
      .toContain("Number(orders?.revenue ?? 0) - Number(returnedMoneyMap.get(agent.agentId)?.returned ?? 0)");
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
    const query = body.slice(at, at + 500);
    expect(query, "тип периода не отобран").toContain('eq(salesTargets.periodType, "monthly")');
    expect(query, "берётся план и из будущих месяцев").toContain("untilDate(salesTargets.periodStart");
    expect(query, "порядок не задан — строка случайная").toContain("orderBy(desc(salesTargets.periodStart))");
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
