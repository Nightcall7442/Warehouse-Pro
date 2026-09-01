import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Куда роль попадает после входа — не должно быть экраном, который ей же
 * запрещён.
 *
 * Ровно это случилось с operator: ROLE_HOME в Home.tsx отправлял его на
 * /dashboard, а все четыре запроса этой страницы (dashboard.kpis, .trends,
 * .statusBreakdown, .activity) заведены на supervisorQuery — ["ceo",
 * "supervisor"], operator в списке не было. У страницы единственная развилка
 * на isError: `if (isError) return <QueryErrorFallback onRetry={refetch} />`.
 * Каждый вход operator в систему показывал экран «не получилось загрузить,
 * повторить» как первый экран после логина, и повтор не помогал — отказ был
 * по роли, не по сбою сети.
 *
 * Проверка читает оба файла как текст и сверяет по имени роли — так же, как
 * bottom-nav-roles.test.ts сверяет BOTTOM_NAV с ROLE_ROUTES. Живого рендера
 * тут нет: цель — поймать расхождение в момент правки одного из двух файлов,
 * а не проверить сами запросы (это дело интеграционных проверок роутера).
 */
const HOME = readFileSync(join(process.cwd(), "src", "pages", "Home.tsx"), "utf8");
const MIDDLEWARE = readFileSync(join(process.cwd(), "api", "middleware.ts"), "utf8");

/** ROLE_HOME — читается из исходника, а не импортируется: важно поймать
 *  само расхождение текста, а не то, что уже пересчитал модуль. */
function roleHome(): Record<string, string> {
  const at = HOME.indexOf("const ROLE_HOME");
  const body = HOME.slice(at, HOME.indexOf("\n};", at));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/^\s*(\w+):\s*"([^"]+)",?$/gm)) out[m[1]] = m[2];
  return out;
}

/** Список ролей у именованного построителя процедур ("...Query = ...requireRole([...])"). */
function rolesOf(builderName: string): string[] {
  const re = new RegExp(`export const ${builderName}\\s*=[^;]*requireRole\\(\\[([^\\]]+)\\]\\)`);
  const m = MIDDLEWARE.match(re);
  if (!m) return [];
  return [...m[1].matchAll(/"(\w+)"/g)].map(x => x[1]);
}

const HOME_MAP = roleHome();

describe("после входа роль не должна упираться в отказ по правам", () => {
  it("исходник разобран, ROLE_HOME не пуст", () => {
    // Если разбор сломается регэкспом, проверки ниже станут зелёными на
    // пустом множестве — а это ровно та беда, которую они должны ловить.
    expect(Object.keys(HOME_MAP).length).toBeGreaterThanOrEqual(6);
  });

  it("supervisorQuery действительно разобран из middleware.ts", () => {
    expect(rolesOf("supervisorQuery").length).toBeGreaterThan(0);
  });

  // /dashboard целиком держится на supervisorQuery — все основные запросы
  // страницы заведены на этот построитель. Держать список ролей здесь, а не
  // дублировать его вручную: если распределение запросов страницы изменится,
  // эта проверка должна поменяться вместе с ним, а не разойтись молча.
  const DASHBOARD_ROLES = new Set(rolesOf("supervisorQuery"));

  for (const [role, dest] of Object.entries(HOME_MAP)) {
    if (dest !== "/dashboard") continue;
    it(`${role}: /dashboard — запросы страницы разрешены этой роли`, () => {
      expect(
        DASHBOARD_ROLES.has(role),
        `ROLE_HOME отправляет «${role}» на /dashboard, но supervisorQuery ` +
        `(её основные запросы) роль «${role}» не пускает — первым экраном ` +
        `после входа будет QueryErrorFallback, и retry не поможет`,
      ).toBe(true);
    });
  }
});
