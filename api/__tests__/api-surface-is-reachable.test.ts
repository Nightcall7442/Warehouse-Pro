import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Ручка, которую не зовёт никто, — это не запас, это долг.
 *
 * ── Болезнь ─────────────────────────────────────────────────────────────────
 *
 * В этом продукте она ловилась уже шесть раз, и каждый раз по-разному больно:
 *
 *   • ручки погрузочного листа написаны и не позваны — у арендатора ВСТАЛА
 *     сборка: одиннадцать заказов заперлись в листе, который нечем закрыть;
 *   • StockService.reserve/release/deduct — три главные операции склада — не
 *     звал никто, и остаток меняли девятнадцать мест сырым SQL;
 *   • процедуры чтения отчётов о визитах, salesTarget.*, getOptimizedRoute,
 *     returns.summary — написаны, выставлены наружу, мертвы.
 *
 * Общее у всех одно: код ЕСТЬ, он проходит проверки типов, его читают при
 * разборе и считают работающим. Он не работает — он просто есть.
 *
 * ── Почему проверка, а не разовая уборка ────────────────────────────────────
 *
 * Убрать сегодняшние сорок восемь — работа на неделю и на отдельное решение
 * владельца: часть из них это НЕДОДЕЛАННЫЕ фичи (перемещения между складами,
 * управление прайс-листами, прогноз спроса), и выбрасывать их нельзя, их надо
 * ДОДЕЛАТЬ. Что можно сделать сегодня — остановить рост и назвать число.
 *
 * Поэтому храповик: число заморожено, вырасти не может. Дописал ручку — либо
 * позови её с экрана, либо объясни, зачем она нужна, подняв число руками.
 * Подключил старую — число падает, и проверка требует опустить потолок.
 *
 * ── Чего проверка НЕ видит ──────────────────────────────────────────────────
 *
 * Мобильное приложение живёт отдельным репозиторием, и здесь его нет. Ручки,
 * которые зовёт только оно, перечислены поимённо ниже — с указанием, где
 * именно. Если мобилка перестанет звать такую ручку, здесь этого не увидят: за
 * тем списком надо следить руками при правках контракта.
 */

const API_DIR = join(__dirname, "..");
const SRC_DIR = join(API_DIR, "..", "src");
const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

/** Пространство имён → файл роутера, как их смонтировал api/router.ts. */
function mountedRouters(): Map<string, string> {
  const src = read(join(API_DIR, "router.ts"));
  const imports = new Map<string, string>();
  for (const m of src.matchAll(/import\s*\{\s*(\w+)\s*\}\s*from\s*"\.\/([\w/-]+)"/g)) {
    imports.set(m[1], m[2]);
  }
  const mounted = new Map<string, string>();
  for (const m of src.matchAll(/^\s*(\w+):\s*(\w+Router),/gm)) {
    const file = imports.get(m[2]);
    if (file) mounted.set(m[1], join(API_DIR, ...file.split("/")) + ".ts");
  }
  return mounted;
}

/** Все ручки: «пространство.имя». */
function allProcedures(): Map<string, string> {
  const out = new Map<string, string>();
  for (const [ns, file] of mountedRouters()) {
    let src: string;
    try { src = read(file); } catch { continue; }
    for (const m of src.matchAll(/^ {2}(\w+):\s*(?:\w+Query|\w+Procedure|publicProcedure|t\.procedure)/gm)) {
      out.set(`${ns}.${m[1]}`, file);
    }
  }
  return out;
}

/** Весь код экранов одной строкой — по нему и ищем вызовы. */
function webSources(): string {
  const parts: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) parts.push(read(full));
    }
  };
  walk(SRC_DIR);
  return parts.join("\n");
}

/**
 * Ручки, которые зовёт ТОЛЬКО мобильное приложение.
 *
 * Оно живёт отдельным репозиторием (Warehouse-Pro-Mobile), и его исходников
 * здесь нет. Список именной, чтобы «мобилка зовёт» нельзя было сказать про
 * что угодно: каждая строка проверена поиском по src/api.ts мобилки.
 */
const MOBILE_ONLY = new Set([
  "agent.availableShops", "agent.getOptimizedRoute", "agent.getShopById",
  "agent.getShopByIdSupervisor", "agent.listAllShops", "agent.listShopsForPlan",
  "agent.myWorkZones", "agent.updateMyShop", "agent.uploadMyShopPhoto",
  "courier.completeDelivery",
  "dashboard.revenueTrend", "dashboard.supervisorDashboard",
  "order.cancel", "order.myOrders",
  "priceList.getById", "priceList.getPrice", "priceList.list",
  "product.findByBarcode",
  // returns.list / getById / summary ушли отсюда: их зовёт и веб — страница
  // возвратов, которой раньше не было вовсе.
  "returns.create",
  "salesTarget.myQuota",
  "settings.brandingAuth",
  "upload.file",
  "user.registerPushToken", "user.removePushToken",
  "warehouseReports.reorderAlerts",
]);

/**
 * Сколько ручек сейчас не зовёт НИКТО — ни экраны, ни мобилка.
 *
 * Число заморожено и опускается по мере того, как ручки подключают или
 * убирают. Выросло — проверка падает и требует объяснить, зачем понадобилась
 * ещё одна мёртвая.
 *
 * 48 → 47: warehouseReports.productBatches подключён к карточке товара. Он
 * появился вместе с учётом партий и был мёртв ровно один вечер — ровно эта
 * проверка его и нашла, в тот же день, когда была написана.
 *
 * 47 → 46: returns.updateStatus. Самая дорогая из мёртвых: это ЕДИНСТВЕННЫЙ
 * способ вывести возврат из «на рассмотрении», и не звал его никто — страницы
 * возвратов в вебе не существовало, мобилка их только заводит. То есть
 * состояние «проведён» было недостижимо через продукт, а на него опираются
 * долг магазина, прибыль, комиссия, доля возвратов в KPI и рейтинг магазина:
 * пять расчётов считали правильно то, чего не бывает.
 */
const BASELINE = 46;

describe("вся поверхность API кем-то вызывается", () => {
  const procedures = allProcedures();
  const web = webSources();

  const unreachable = [...procedures.keys()]
    .filter(key => !web.includes(key))
    .filter(key => !MOBILE_ONLY.has(key))
    .sort();

  it("разбор нашёл роутеры и ручки, а не пустоту", () => {
    // Проверка, которая ничего не разобрала, зелена всегда.
    expect(procedures.size, "ручек не найдено — разбор роутера сломан").toBeGreaterThan(200);
    expect(web.length, "исходники экранов не прочитаны").toBeGreaterThan(100_000);
    // Заведомо живая ручка обязана находиться: иначе поиск вызовов не работает.
    expect(web).toContain("order.list");
  });

  it("мёртвых ручек не становится больше", () => {
    const byFile = new Map<string, string[]>();
    for (const key of unreachable) {
      const file = procedures.get(key)!.split(/[\\/]/).slice(-2).join("/");
      byFile.set(file, [...(byFile.get(file) ?? []), key]);
    }
    const report = [...byFile.entries()]
      .map(([file, keys]) => `  ${file}\n${keys.map(k => `      ${k}`).join("\n")}`)
      .join("\n");

    expect(
      unreachable.length,
      unreachable.length <= BASELINE ? "" :
        `Мёртвых ручек стало ${unreachable.length} (было ${BASELINE}):\n${report}\n\n` +
        `Ручка, которую не зовёт ни один экран, не работает — она просто есть.\n` +
        `Так у арендатора встала сборка: ручки закрытия погрузочного листа были\n` +
        `написаны и не позваны, и одиннадцать заказов заперлись без выхода.\n\n` +
        `Позовите её с экрана, уберите — или, если она нужна мобилке, впишите\n` +
        `в MOBILE_ONLY, проверив по src/api.ts мобильного приложения.`,
    ).toBeLessThanOrEqual(BASELINE);
  });

  it("храповик крутится в одну сторону", () => {
    // Подключили мёртвую — опустите потолок, иначе он перестанет держать.
    expect(
      unreachable.length,
      `Мёртвых ручек стало меньше (${unreachable.length} вместо ${BASELINE}) — ` +
      `опустите BASELINE, чтобы храповик не дал им вернуться.`,
    ).toBe(BASELINE);
  });

  it("список мобильных ручек не покрывает несуществующие", () => {
    /*
      Список именной, и он ветшает: ручку переименовали или убрали, а строка
      осталась — и прикрывает уже другую дыру, потому что имя в множестве
      просто не совпадает ни с чем.
    */
    const stale = [...MOBILE_ONLY].filter(key => !procedures.has(key));
    expect(stale, `в MOBILE_ONLY остались ручки, которых больше нет: ${stale.join(", ")}`).toEqual([]);
  });

  it("в список мобильных не попали те, кого зовут экраны", () => {
    // Иначе он прикрывал бы живые ручки и тихо рос.
    const alsoWeb = [...MOBILE_ONLY].filter(key => web.includes(key));
    expect(alsoWeb, `эти ручки зовут экраны — из MOBILE_ONLY их надо убрать: ${alsoWeb.join(", ")}`).toEqual([]);
  });
});
