import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NAV_ITEMS, ROLE_ROUTES } from "@/const";

/**
 * Нижняя панель на телефоне.
 *
 * У доставщика её не было: в BOTTOM_NAV просто отсутствовал ключ courier.
 * Панель при этом всё равно рисовалась — с пустым списком, — и внизу экрана
 * оставалась глухая полоса в 60 точек. Она закрывала последнюю строку списка
 * и никуда не вела; на телефоне это единственный способ перейти между
 * экранами, то есть роль оставалась вообще без переходов.
 */
const LAYOUT = readFileSync(join(process.cwd(), "src", "components", "Layout.tsx"), "utf8");
const APP = readFileSync(join(process.cwd(), "src", "App.tsx"), "utf8");

/** Роли и пути из BOTTOM_NAV — читаются из самого исходника. */
function bottomNav(): Record<string, string[]> {
  const at = LAYOUT.indexOf("const BOTTOM_NAV");
  const body = LAYOUT.slice(at, LAYOUT.indexOf("\n};", at));
  const out: Record<string, string[]> = {};
  for (const m of body.matchAll(/^ {2}(\w+): \[$/gm)) {
    const from = m.index! + m[0].length;
    const block = body.slice(from, body.indexOf("\n  ],", from));
    out[m[1]] = [...block.matchAll(/path: "([^"]+)"/g)].map(p => p[1]);
  }
  return out;
}

const BOTTOM = bottomNav();

describe("у каждой роли есть чем ходить по приложению", () => {
  it("исходник разобран, роли найдены", () => {
    // Если разбор сломается, все проверки ниже станут зелёными на пустом
    // множестве — а это ровно та беда, которую они должны ловить.
    expect(Object.keys(BOTTOM).length).toBeGreaterThanOrEqual(5);
  });

  for (const role of Object.keys(NAV_ITEMS)) {
    it(`${role}: панель внизу не пустая`, () => {
      expect(
        BOTTOM[role]?.length ?? 0,
        `у роли «${role}» есть боковое меню, но нет нижней панели — на телефоне она останется без переходов`,
      ).toBeGreaterThan(0);
    });
  }

  for (const [role, paths] of Object.entries(BOTTOM)) {
    it(`${role}: пункты ведут на существующие страницы`, () => {
      for (const path of paths) {
        const route = path === "/" ? `path="/"` : `path="${path}"`;
        expect(APP.includes(route), `«${path}» у роли «${role}» не заведён в App.tsx`).toBe(true);
      }
    });

    it(`${role}: начальная страница роли есть в панели`, () => {
      // Куда роль попадает после входа — туда должна вести и панель, иначе
      // вернуться на свой главный экран нечем.
      const home = ROLE_ROUTES[role];
      if (!home) return;
      expect(paths, `после входа роль «${role}» попадает на ${home}, а в панели такого пункта нет`).toContain(home);
    });
  }
});

describe("пустая панель не занимает низ экрана", () => {
  it("роль без пунктов не рисует полосу", () => {
    const fn = LAYOUT.slice(LAYOUT.indexOf("const BottomNav = memo"));
    const head = fn.slice(0, fn.indexOf("return ("));
    expect(head, "пустая панель снова рисуется и перекрывает содержимое").toContain("if (items.length === 0) return null;");
  });
});
