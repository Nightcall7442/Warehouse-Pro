import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * В зарплате нет слагаемых, которых никто не назначал.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * К зарплате агента прибавлялась премия:
 *
 *     baseBonus = round(продажи × 0.02)
 *     премия    = round(baseBonus × баллKPI / 100)
 *
 * Два процента были ЗАШИТЫ числом в коде: ни в настройках, ни в тарифе, ни в
 * разделе комиссий их не было. Их не назначал никто — ни платформа, ни
 * арендатор, — а платились они всерьёз: арендатор, поставивший агенту 5%,
 * отдавал до 7%. Пять назначенных и до двух, о которых он не знал.
 *
 * Убрана по решению владельца 11.09.2026. Балл KPI остался и считается
 * по-прежнему: он показывает работу, но денег больше не двигает.
 *
 * ── Что стережёт этот файл ──────────────────────────────────────────────────
 *
 * Не только возвращение премии. Общее правило: в формуле зарплаты не должно
 * быть НИ ОДНОГО множителя, взятого из воздуха. Всякая доля, на которую
 * умножают деньги человека, обязана приходить из настройки — либо из
 * названной константы с объяснением, откуда она.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

/** Комментарий — не код: разбор выше называет и 0.02, и премию. */
const strip = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const KPI = strip(read("api/services/kpi.ts"));

/** Тело функции — от её начала до следующей верхнеуровневой. */
function bodyOf(name: string): string {
  const at = KPI.indexOf(name);
  expect(at, `не найдено: ${name}`).toBeGreaterThan(-1);
  const rest = KPI.slice(at);
  const next = rest.search(/\n(?:export )?(?:async )?function \w+|\nexport async function \w+/);
  return next > 0 ? rest.slice(0, next) : rest;
}

describe("премии в зарплате нет", () => {
  it("её никто не считает", () => {
    expect(KPI, "премия вернулась в расчёт").not.toContain("calculateBonus");
    expect(KPI, "премия вернулась в ответ").not.toContain("bonusAmount");
  });

  it("итог складывается только из назначенного", () => {
    /*
      Оклад ставят человеку, комиссию — процентом, который выбрал арендатор,
      вычет — за подозрительные визиты. Каждое слагаемое кто-то назначил.
    */
    const at = KPI.indexOf("const totalSalary = isCourier");
    expect(at, "расчёт итога не найден").toBeGreaterThan(-1);
    const formula = KPI.slice(at, KPI.indexOf(";", at));
    expect(formula).toContain("baseSalary + commissionAmount - fraudDeduction");
    expect(formula, "в итоге снова появилась премия").not.toMatch(/bonus/i);
  });

  it("экраны её не показывают", () => {
    for (const p of ["src/pages/AgentKpi.tsx", "src/pages/Salaries.tsx"]) {
      const src = strip(read(p));
      expect(src, `${p}: премия вернулась на экран`).not.toMatch(/bonusAmount|Бонус|ПРЕМИИ/);
    }
  });
});

describe("в зарплате нет множителей из воздуха", () => {
  it("доли берутся из настроек, а не из чисел в коде", () => {
    /*
      Ищем в расчёте зарплаты голые дроби вида 0.02 — ровно тем видом, каким
      была записана премия. Исключение одно и названо явно: половина в вычете
      за подозрительные визиты.

      Проверка нарочно грубая. Тонкая пропустила бы следующий такой множитель,
      а он стоит денег людям и обнаруживается только когда кто-то сядет
      сверять зарплату руками.
    */
    const salary = bodyOf("export async function calculateSalary");
    const literals = [...salary.matchAll(/[^.\w](0\.\d+)/g)].map(m => m[1]);
    const allowed = new Set(["0.5"]); // половина в вычете за фрод — названа в коде рядом
    const invented = literals.filter(l => !allowed.has(l));
    expect(
      invented,
      `в расчёте зарплаты доли, которых никто не назначал: ${invented.join(", ")}. ` +
      "Всякая доля, на которую умножают деньги человека, должна приходить из настройки.",
    ).toEqual([]);
  });

  it("проверка выше действительно что-то видит", () => {
    // Иначе «ни одной доли» означало бы лишь то, что разбор ничего не нашёл.
    const salary = bodyOf("export async function calculateSalary");
    expect(salary.length, "тело расчёта не разобралось").toBeGreaterThan(2000);
    expect(salary, "вычет за фрод пропал — тогда и исключение выше лишнее").toContain("0.5");
  });
});

describe("балл KPI остался", () => {
  it("его считают и показывают", () => {
    // Премия ушла, а оценка работы — нет: по ней смотрят, как человек
    // работает, просто денег она больше не двигает.
    expect(KPI).toContain("kpiScore: kpi.kpiScore");
    expect(strip(read("src/pages/AgentKpi.tsx"))).toContain("salary.kpiScore");
  });
});
