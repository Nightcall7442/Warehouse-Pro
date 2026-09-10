import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Предел по товарам действует, а не обещает.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * checkPlanLimits умела считать товары с самого первого дня: ветка
 * `resource === "products"` написана, разобрана до мелочей, покрыта типами. И
 * её не звал НИКТО. Число SKU стояло на странице тарифов, рисовалось полосой в
 * оплате, участвовало в цене надбавки — и не ограничивало ничего. Организация
 * на Basic заводила три тысячи позиций при обещанных пятидесяти.
 *
 * Это тот самый повторяющийся дефект: «написано, но не вызывается ниоткуда».
 * Он тем и опасен, что снаружи выглядит работающим — код есть, тесты на саму
 * функцию есть, полоса на экране движется.
 *
 * ── Что проверяется здесь ───────────────────────────────────────────────────
 *
 * Что предел спрашивают ВСЕ три двери, которыми товар попадает в базу: руками,
 * файлом и обменом с 1С. Закрыть одну и оставить две — то же самое, что не
 * закрывать: выгрузка из 1С обходит предел в один щелчок.
 */
const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

/** Файлы, которые вставляют строки в products (кроме тестов). */
function productWriters(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.resolve(process.cwd(), dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== "__tests__") walk(rel);
      } else if (entry.name.endsWith(".ts") && read(rel).includes("insert(products)")) {
        out.push(rel);
      }
    }
  };
  walk("api");
  return out;
}

describe("предел по товарам спрашивают на каждой двери", () => {
  it("товар руками", () => {
    const src = read("api/product-router.ts");
    const at = src.indexOf("  create: operatorQuery");
    expect(at).toBeGreaterThan(0);
    const body = src.slice(at, src.indexOf("insert(products)", at));
    expect(body, "создание товара не спрашивает предел").toContain('checkPlanLimits(db, tenantId, "products")');
    expect(body).toContain("FORBIDDEN");
    // Отказ обязан назвать числа: «50 из 50» говорит, что делать.
    expect(body).toContain("${limits.current} из ${limits.limit}");
  });

  it("загрузка из файла", () => {
    const src = read("api/import-router.ts");
    expect(src).toContain('checkPlanLimits(db, tenantId, "products")');
    /*
      Место читается ОДИН раз до цикла и уменьшается по ходу: запрос на каждую
      строку — это тысяча запросов на тысячной выгрузке, и импорт вставал бы
      по времени раньше, чем упирался в предел.
    */
    const at = src.indexOf('checkPlanLimits(db, tenantId, "products")');
    const loop = src.indexOf("for (const row of parsedRows)", at);
    expect(loop, "проверка оказалась после цикла").toBeGreaterThan(at);
    expect(src).toContain("if (room <= 0) { blockedByPlan++; continue; }");
    expect(src).toContain("room--;");
    // Непоместившееся называется, а не пропадает молча.
    expect(src).toContain("позиций не заведено: предел тарифа");
  });

  it("обмен с 1С", () => {
    const src = read("api/services/onec-sync.ts");
    expect(src, "выгрузка из 1С обходит предел").toContain('checkPlanLimits(db, tenantId, "products")');
    expect(src).toContain("blockedByPlan++;");
    /*
      Уже заведённые товары обмен продолжает обновлять при любом пределе:
      предел не даёт заводить НОВЫЕ, а не отключает синхронизацию. Ветка
      обновления идёт до проверки места.
    */
    const update = src.indexOf(".update(products)");
    const check = src.indexOf("} else if (room <= 0) {");
    expect(update).toBeGreaterThan(0);
    expect(check, "проверка места встала раньше обновления").toBeGreaterThan(update);
  });

  it("новых дверей не появилось", () => {
    /*
      Список выводится из кода, а не записан руками: появится четвёртое место,
      вставляющее товар, — проверка назовёт его, и решение «спрашивать ли там
      предел» будет принято осознанно, а не пропущено.

      ProductService.create в списке не случайно: он не вызывается ниоткуда
      (мёртвый код), и это отдельный разговор — но пока он в дереве, дверью он
      считается.
    */
    expect(productWriters().sort()).toEqual([
      "api/import-router.ts",
      "api/product-router.ts",
      "api/services/ProductService.ts",
      /*
        Заполнение песочницы предел не спрашивает — решение, а не пропуск.

        Оно заводит РОВНО двенадцать товаров и только в собственной, только что
        созданной организации на тарифе Exclusive, где предел двести пятьдесят
        (contracts/constants.ts). Упереться в него оно не может ни при каком
        стечении: организация пуста по построению — seedSandbox отказывается
        работать там, где уже есть заказы, — и число товаров задано в коде, а
        не приходит от человека.

        Проверка предела здесь была бы обрядом: она никогда не отказала бы и
        притворялась бы защитой там, где защищать нечего.
      */
      "api/services/sandbox.ts",
      "api/services/onec-sync.ts",
    ].sort());
  });

  it("ProductService.create по-прежнему никем не зовётся", () => {
    // Единственная дверь без проверки — и только потому, что в неё не ходят.
    // Появится вызов — здесь станет видно, и предел придётся добавить туда же.
    const callers = productWriters()
      .concat(["api/router.ts"])
      .filter(f => f !== "api/services/ProductService.ts")
      .filter(f => /ProductService\.create|productService\.create/.test(read(f)));
    expect(callers, "у мёртвого создания товара появился вызов без проверки предела").toEqual([]);
  });
});
