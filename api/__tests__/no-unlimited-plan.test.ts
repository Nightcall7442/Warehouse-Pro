import { describe, it, expect } from "vitest";
import { PLANS, EXTRA_PRICES_UZS, PLAN_PRICES_UZS, type PlanKey } from "@contracts/constants";

/**
 * Безлимита не осталось ни у кого.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * У Exclusive стояли maxUsers: null и maxProducts: null — «сколько угодно».
 * Два последствия, и оба денежные. Первое: себестоимость такого арендатора
 * нечем оценить заранее — он один может занять столько же, сколько все
 * остальные вместе. Второе: надбавки за место и позицию (EXTRA_PRICES_UZS)
 * на старшем тарифе теряют смысл вовсе, потому что докупать нечего.
 *
 * ── Что проверяется здесь ───────────────────────────────────────────────────
 *
 * Что предел есть у каждого тарифа и что лестница не сломана: старший даёт
 * больше младшего, а переход выгоднее надбавки при большой нужде. Заказы —
 * названное исключение: их число это оборот арендатора.
 */
const PAID: PlanKey[] = ["basic", "pro", "exclusive"];

describe("пределы тарифов", () => {
  it("места и позиции ограничены у всех тарифов", () => {
    for (const key of Object.keys(PLANS) as PlanKey[]) {
      const plan = PLANS[key];
      expect(plan.maxUsers, `${key}: места без предела`).not.toBeNull();
      expect(plan.maxProducts, `${key}: позиции без предела`).not.toBeNull();
    }
  });

  it("заказы остаются без предела на платных — и это нарочно", () => {
    /*
      Единственное исключение, и оно названо здесь, а не выведено из молчания.
      Число заказов — это оборот арендатора; брать с него деньги за успех
      значит наказывать за рост. У пробного предел есть — иначе им бы жили.
    */
    expect(PLANS.trial.maxOrdersMonth).not.toBeNull();
    for (const key of PAID) {
      expect(PLANS[key].maxOrdersMonth, `${key}: у заказов появился предел`).toBeNull();
    }
  });

  it("старший тариф даёт строго больше младшего", () => {
    const ladder: PlanKey[] = ["trial", "basic", "pro", "exclusive"];
    for (let i = 1; i < ladder.length; i++) {
      const prev = PLANS[ladder[i - 1]];
      const next = PLANS[ladder[i]];
      expect(Number(next.maxUsers), `${ladder[i]}: мест не больше, чем у ${ladder[i - 1]}`)
        .toBeGreaterThan(Number(prev.maxUsers));
      expect(Number(next.maxProducts), `${ladder[i]}: позиций не больше, чем у ${ladder[i - 1]}`)
        .toBeGreaterThan(Number(prev.maxProducts));
    }
  });

  it("переход на старший дешевле надбавки — иначе тарифы никто не меняет", () => {
    /*
      Смысл лестницы: кому нужно МНОГО — переходит, кому не хватает пары
      десятков — докупает. Значит цена единицы «внутри перехода» должна быть
      ниже цены надбавки. Разъедься это однажды, и старший тариф стал бы
      заведомо невыгодным, а заметили бы по тому, что его никто не берёт.
    */
    const step = (from: PlanKey, to: PlanKey) => {
      const money = PLAN_PRICES_UZS[to] - PLAN_PRICES_UZS[from];
      return {
        perUser:    money / (Number(PLANS[to].maxUsers) - Number(PLANS[from].maxUsers)),
        perProduct: money / (Number(PLANS[to].maxProducts) - Number(PLANS[from].maxProducts)),
      };
    };
    const toPro = step("basic", "pro");
    const toExclusive = step("pro", "exclusive");

    expect(toPro.perUser).toBeLessThan(EXTRA_PRICES_UZS.user);
    expect(toExclusive.perUser).toBeLessThan(EXTRA_PRICES_UZS.user);
    // По позициям надбавка нарочно дешевле перехода с Basic: докупить два
    // десятка выгоднее, чем менять тариф. На старшем переходе — наоборот.
    expect(toPro.perProduct).toBeGreaterThan(EXTRA_PRICES_UZS.product);
    expect(toExclusive.perProduct).toBeLessThan(EXTRA_PRICES_UZS.product);
  });
});
