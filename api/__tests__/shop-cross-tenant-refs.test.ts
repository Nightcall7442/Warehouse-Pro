import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Магазин не может ссылаться на чужого сотрудника или чужую территорию.
 *
 * Дыра состояла из двух половин, и работала только вместе.
 *
 * Запись: `agentId` и `territoryId` приходят от клиента и сохранялись как есть,
 * без проверки принадлежности. Чтение: карточка магазина, список магазинов и
 * отчёт по должникам соединялись с users по одному лишь `shops.agent_id`, без
 * условия по организации. Достаточно было указать своему магазину чужой
 * agentId и открыть карточку, чтобы получить имя и почту пользователя другой
 * компании. Перебором так выгружалась вся база пользователей платформы,
 * включая суперадминов.
 *
 * Проверяется по исходнику: обе половины — это условия внутри процедур, и
 * поддельная база, которая понимает не все условия, доказала бы здесь ровно
 * ничего. Смысл теста в том, чтобы ни одна из половин не пропала при
 * последующих правках — по отдельности они защиты не дают.
 */

const SRC = readFileSync(join(process.cwd(), "api", "shop-router.ts"), "utf8");

function procedure(name: string): string {
  const start = SRC.indexOf(`${name}:`);
  expect(start, `процедура ${name} не найдена — тест устарел`).toBeGreaterThan(-1);
  const rest = SRC.slice(start + name.length);
  // Следующая процедура верхнего уровня начинается с двух пробелов и имени.
  const end = rest.search(/\n  [a-zA-Z]+:/);
  return rest.slice(0, end === -1 ? rest.length : end);
}

describe("запись: чужой идентификатор не сохраняется", () => {
  for (const proc of ["create", "update"]) {
    it(`${proc} проверяет agentId и territoryId по организации`, () => {
      const body = procedure(proc);
      expect(
        body,
        `${proc} сохраняет agentId/territoryId без проверки — можно сослаться на чужого сотрудника`,
      ).toContain("assertTenantOwnsRefs");
    });
  }

  it("проверка сверяет обе таблицы именно по организации", () => {
    const helper = SRC.slice(SRC.indexOf("async function assertTenantOwnsRefs"));
    const body = helper.slice(0, helper.indexOf("\n}\n"));

    // Без eq(...tenantId) проверка выродится в «такой id вообще существует»,
    // что верно для любого чужого пользователя.
    expect(body).toMatch(/from\(users\)[\s\S]{0,200}eq\(users\.tenantId, tenantId\)/);
    expect(body).toMatch(/from\(territories\)[\s\S]{0,200}eq\(territories\.tenantId, tenantId\)/);
  });
});

describe("чтение: соединение не выдаёт чужую строку", () => {
  it("ни одно соединение с users не идёт без границы организации", () => {
    // Вторая половина защиты и единственная, которая работает на строках,
    // записанных ДО этой правки: в базе уже могут лежать чужие ссылки.
    const naked = [...SRC.matchAll(/leftJoin\(users,\s*eq\(/g)];
    expect(
      naked.length,
      "есть leftJoin(users, eq(...)) без условия по организации — карточка выдаст чужого пользователя",
    ).toBe(0);
  });

  it("карточка магазина читает агента с условием по организации", () => {
    const body = procedure("getById");
    expect(body).toMatch(/from\(users\)[\s\S]{0,160}eq\(users\.tenantId, tenantId\)/);
  });

  it("сводка по территориям считает только свои магазины", () => {
    // Иначе чужой магазин, сославшийся на нашу территорию, попадёт в счётчик и
    // в сумму долга.
    expect(SRC).toMatch(/leftJoin\(shops,\s*and\(eq\(territories\.id, shops\.territoryId\), eq\(shops\.tenantId/);
  });

  it("отчёт по должникам не соединяется с users без границы", () => {
    const body = procedure("debtReport");
    expect(body).toMatch(/leftJoin\(users,\s*and\(/);
  });
});
