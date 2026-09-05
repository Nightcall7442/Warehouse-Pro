import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Пункт меню не должен вести в отказ по правам.
 *
 * Такая беда в проекте уже была: у оператора все четыре запроса главной шли на
 * supervisorQuery, и он видел «не удалось загрузить» как первый экран после
 * входа, а «Повторить» повторял тот же отказ — заявка отклонена не сбоем, а
 * правами (разбор в src/pages/Home.tsx).
 *
 * Здесь то же самое нашлось у оператора на «Магазинах»: чтение списка стояло
 * на supervisorQuery, при том что создание, изменение и оплата магазина —
 * operatorQuery. То есть править и платить он мог, а открыть список нет.
 */
const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8");
const MW = read("api/middleware.ts");
const SHOP = read("api/shop-router.ts");

/** Какие роли пускает вид процедуры. */
function rolesOf(kind: string): string[] {
  const at = MW.indexOf(`export const ${kind}`);
  expect(at, `вид процедуры ${kind} не найден`).toBeGreaterThan(0);
  const decl = MW.slice(at, MW.indexOf(";", at));
  const m = decl.match(/requireRole\(\[([^\]]+)\]\)/);
  expect(m, `${kind} без requireRole`).not.toBeNull();
  return m![1].split(",").map((x) => x.trim().replace(/"/g, ""));
}

/** Вид процедуры, на которой объявлена операция. */
function kindOf(src: string, op: string): string {
  const m = src.match(new RegExp(`^  ${op}:\\s*(\\w+Query)`, "m"));
  expect(m, `операция ${op} не найдена`).not.toBeNull();
  return m![1];
}

describe("оператор и магазины", () => {
  it("может открыть список, раз может его править", () => {
    const canRead = rolesOf(kindOf(SHOP, "list"));
    expect(canRead, "оператору снова закрыли список магазинов").toContain("operator");
  });

  it("карточка и территории — по тому же правилу", () => {
    // Иначе список открывается, а тап по магазину снова упирается в отказ.
    expect(rolesOf(kindOf(SHOP, "getById"))).toContain("operator");
    expect(rolesOf(kindOf(SHOP, "territories"))).toContain("operator");
  });

  it("права на чтение не шире прав на запись", () => {
    /*
      Смысл правки был в согласовании, а не в раздаче доступа: читать должны
      ровно те, кто и так пишет. Если чтение когда-нибудь окажется доступно
      кому-то ещё, это уже другое решение и принимать его надо осознанно.
    */
    const write = new Set(rolesOf(kindOf(SHOP, "update")));
    const extra = rolesOf(kindOf(SHOP, "list")).filter((r) => !write.has(r) && r !== "supervisor");
    expect(extra, `чтение открыли шире записи: ${extra.join(", ")}`).toEqual([]);
  });
});
