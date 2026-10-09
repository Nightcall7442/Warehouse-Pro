import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Места и товары сверх тарифа.
 *
 * ── Зачем ───────────────────────────────────────────────────────────────────
 *
 * У арендатора на Basic кончились пятьдесят позиций номенклатуры, а переходить
 * на Pro ради десяти новых незачем. Раньше выход был один — поднять тариф
 * целиком. Теперь суперадмин добавляет ровно столько, сколько нужно, по
 * 5 000 сум за товар и 35 000 за место в месяц.
 *
 * ── Чего здесь боятся ───────────────────────────────────────────────────────
 *
 * Двух вещей. Первая: надбавка должна ДЕЙСТВОВАТЬ — то есть попасть в проверку
 * лимитов, а не остаться числом в базе, которое никто не читает. Ровно так уже
 * лежат рядом tenants.max_users и max_products: поля есть, лимиты берутся мимо
 * них. Вторая: то, что видит арендатор на экране оплаты, должно совпадать с
 * тем, что ему разрешено на самом деле.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("надбавка действует, а не лежит в базе", () => {
  const limits = read("api/lib/plan-limits.ts");

  it("проверка лимитов складывает тариф и докупленное", () => {
    /*
      Главная проверка файла. Без этого суперадмин выдаёт места, деньги берут, а
      человек упирается в прежний предел — и жалуется он не на нас, а своему
      директору.
    */
    expect(limits).toContain("withExtra(plan.maxUsers, tenant.extraUsers)");
    expect(limits).toContain("withExtra(plan.maxProducts, tenant.extraProducts)");
  });

  it("безлимитному тарифу надбавка ничего не портит", () => {
    // К «сколько угодно» прибавлять нечего: null должен остаться null, иначе
    // Exclusive получил бы предел там, где его нет.
    expect(limits).toContain("base === null ? null :");
  });

  it("отрицательная надбавка не уменьшает тарифный предел", () => {
    // Иначе −60 у Basic закрыл бы каталог целиком.
    expect(limits).toContain("Math.max(0, Number(extra ?? 0))");
  });
});

describe("экран оплаты показывает то, что разрешено", () => {
  const billing = read("api/billing-router.ts");

  it("предел на экране — с надбавкой", () => {
    /*
      Показывать голый тарифный нельзя: у арендатора, докупившего двадцать
      позиций, полоса упёрлась бы в пятьдесят и кричала «предел исчерпан»,
      когда свободно ещё двадцать.
    */
    expect(billing).toContain("maxUsers:       withExtra(eff.maxUsers, extraUsers)");
    expect(billing).toContain("maxProducts:    withExtra(eff.maxProducts, extraProducts)");
    // Надбавка — только прежнему тарифу, пока он действует (05.10.2026).
    expect(billing).toContain("const extraUsers    = grandfathered ? Number(tenant.extraUsers ?? 0) : 0;");
  });

  it("доплата считается на сервере, а не в уме", () => {
    expect(billing).toContain("LEGACY_EXTRA_PRICES_UZS.user");
    expect(billing).toContain("LEGACY_EXTRA_PRICES_UZS.product");
  });

  it("откуда взялось число — сказано словами", () => {
    // Арендатор видит 70 у тарифа, который обещает 50: без объяснения непонятно,
    // кому верить.
    expect(read("src/components/billing/UsageSection.tsx")).toContain("докупленных сверх тарифа");
  });
});

describe("выдаёт только платформа", () => {
  const router = read("api/tenant-router.ts");

  it("ручка закрыта от арендаторов", () => {
    // Иначе директор выпишет себе сто мест сам.
    expect(router).toMatch(/setExtraLimits:\s*superAdminQuery/);
  });

  it("задаётся итоговое число, а не «добавить ещё»", () => {
    /*
      Значение в поле совпадает с тем, что видно рядом, и повторное нажатие
      «Сохранить» ничего не удваивает. С «добавить ещё» второе нажатие по
      привычке стоило бы арендатору лишних мест.
    */
    const at = router.indexOf("setExtraLimits:");
    const body = router.slice(at, router.indexOf("}),", at));
    expect(body).toContain("set({ extraUsers: input.extraUsers, extraProducts: input.extraProducts })");
    expect(body).not.toMatch(/extraUsers\s*\+/);
  });

  it("есть потолок от промаха на клавиатуре", () => {
    // «5000» вместо «500» — это двадцать пять миллионов сум в месяц.
    const at = router.indexOf("setExtraLimits:");
    expect(router.slice(at, at + 400)).toContain("max(1000)");
  });

  it("кто и когда раздал места — остаётся в журнале", () => {
    const at = router.indexOf("setExtraLimits:");
    expect(router.slice(at, router.indexOf("}),", at))).toContain("recordAudit");
  });
});
