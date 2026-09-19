/**
 * Боковое меню: главные разделы снаружи, остальные внутри.
 *
 * Владелец (19.09.2026): «в сайдбаре поменьше разделов — только главные,
 * остальные внутри». У директора было девятнадцать пунктов, нижние за краем
 * экрана. Теперь шесть: Главная и пять групп; пункты группы раскрываются
 * только у той группы, где человек сейчас (или которую открыл рукой).
 * «Отчёты склада» пунктом больше нет — это вкладка на странице склада.
 *
 * Нарочная поломка: убери `group: "sales"` у «Возвратов» — упадёт «у директора
 * шесть строк»; верни `/warehouse-reports` в NAV_ITEMS — упадёт «отчёты склада
 * — вкладка»; сделай в navRows `open === item.group` всегда true — упадёт
 * «раскрыта одна группа».
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NAV_ITEMS, NAV_GROUPS, navRows } from "@/const";
import { t } from "@/i18n";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
type Row = ReturnType<typeof navRows>[number];
type GroupRow = Extract<Row, { kind: "group" }>;
const top = (rows: Row[]) => rows.filter(r => r.kind === "group" || !r.nested);
const label = (r: Row) => r.kind === "group" ? r.labelKey : r.item.labelKey;
const groupsOf = (rows: Row[]) => rows.filter((r): r is GroupRow => r.kind === "group");

describe("строки меню", () => {
  it("директор на складе: девять строк снаружи — Магазины, Настройки, Биллинг и Журнал отдельно (владелец, 19.09); раскрыт только «Склад»", () => {
    const rows = navRows(NAV_ITEMS.ceo, "/warehouse", undefined);
    expect(top(rows).map(label)).toEqual(["nav.dashboard", "nav.groupSales", "nav.shops", "nav.warehouse", "nav.groupTeam", "nav.groupFinance", "nav.settings", "nav.billing", "nav.auditLog"]);
    const groups = groupsOf(rows);
    expect(groups.filter(g => g.open).map(g => g.key)).toEqual(["warehouse"]);
    expect(groups.find(g => g.key === "warehouse")!.active).toBe(true);
    const nested = rows.flatMap(r => r.kind === "item" && r.nested ? [[r.item.labelKey, r.active]] : []);
    expect(nested).toEqual([["nav.stock", true], ["nav.arrivals", false], ["nav.products", false]]);
  });

  it("оператор: семь строк — Главная, Продажи, Магазины, Склад, Отчёты, KPI, Настройки", () => {
    expect(top(navRows(NAV_ITEMS.operator, "/orders", undefined)).map(label))
      .toEqual(["nav.dashboard", "nav.groupSales", "nav.shops", "nav.warehouse", "nav.reports", "nav.kpi", "nav.settings"]);
  });

  it("вложенный адрес подсвечивает самый длинный пункт, а не оба: /supervisor/plans — «План визитов», не «Карта»", () => {
    const rows = navRows(NAV_ITEMS.ceo, "/supervisor/plans", undefined);
    const active = rows.flatMap(r => r.kind === "item" && r.active ? [r.item.path] : []);
    expect(active).toEqual(["/supervisor/plans"]);
    expect(groupsOf(rows).find(g => g.key === "team")!.open).toBe(true);
  });

  it("«Главная» — только по точному адресу: на /orders она не горит", () => {
    const rows = navRows(NAV_ITEMS.ceo, "/orders", undefined);
    const home = rows.find(r => r.kind === "item" && r.item.path === "/");
    expect(home && home.kind === "item" && home.active).toBe(false);
  });

  it("открытая рукой группа: раскрыта она, а группа с текущей страницей — свёрнута, но помечена", () => {
    const rows = navRows(NAV_ITEMS.ceo, "/warehouse", "sales");
    const groups = groupsOf(rows);
    expect(groups.filter(g => g.open).map(g => g.key)).toEqual(["sales"]);
    expect(groups.find(g => g.key === "warehouse")!.active).toBe(true);
    // null — всё свёрнуто; след текущей страницы остаётся.
    const closed = groupsOf(navRows(NAV_ITEMS.ceo, "/warehouse", null));
    expect(closed.some(g => g.open)).toBe(false);
    expect(closed.find(g => g.key === "warehouse")!.active).toBe(true);
    // Другая страница — правило «где я, там раскрыто» действует снова.
    expect(groupsOf(navRows(NAV_ITEMS.ceo, "/pnl", undefined)).filter(g => g.open).map(g => g.key)).toEqual(["finance"]);
    // Пункты, оставленные снаружи, — не в группе и подсвечиваются сами.
    const billing = navRows(NAV_ITEMS.ceo, "/billing", undefined);
    expect(groupsOf(billing).some(g => g.open)).toBe(false);
    expect(billing.find(r => r.kind === "item" && r.item.path === "/billing")).toMatchObject({ active: true, nested: false });
  });

  it("роли без групп (агент, супервайзер, курьер) — как были: плоский список", () => {
    for (const role of ["agent", "supervisor", "merchandiser", "courier", "superadmin"]) {
      const rows = navRows(NAV_ITEMS[role], "/x", undefined);
      expect(rows.every(r => r.kind === "item" && !r.nested), role).toBe(true);
      expect(rows).toHaveLength(NAV_ITEMS[role].length);
    }
  });
});

describe("устройство меню", () => {
  it("в группе не меньше двух пунктов, у каждой группы есть слово на обоих языках", () => {
    for (const role of ["ceo", "operator"]) {
      const byGroup = new Map<string, number>();
      for (const it of NAV_ITEMS[role]) if (it.group) byGroup.set(it.group, (byGroup.get(it.group) ?? 0) + 1);
      for (const [g, n] of byGroup) expect(n, `${role}: группа ${g}`).toBeGreaterThanOrEqual(2);
    }
    for (const g of Object.values(NAV_GROUPS)) {
      expect(t("ru", g.labelKey), g.labelKey).not.toBe(g.labelKey);
      expect(t("uz", g.labelKey), g.labelKey).not.toBe(g.labelKey);
    }
    for (const items of Object.values(NAV_ITEMS)) for (const it of items) {
      expect(t("ru", it.labelKey), it.labelKey).not.toBe(it.labelKey);
      expect(t("uz", it.labelKey), it.labelKey).not.toBe(it.labelKey);
    }
  });

  it("отчёты склада — вкладка на странице склада, а не пункт меню; прежний адрес ведёт туда", () => {
    for (const items of Object.values(NAV_ITEMS)) expect(items.some(i => i.path === "/warehouse-reports")).toBe(false);
    expect(read("src/App.tsx")).toContain('<Route path="/warehouse-reports" element={<Navigate to="/warehouse?tab=reports" replace />} />');
    expect(read("src/App.tsx")).not.toContain('import("./pages/WarehouseReports")');
    const wh = read("src/pages/Warehouse.tsx");
    expect(wh).toContain('{activeTab === "reports" && <WarehouseReports />}');
    expect(wh).toContain('searchParams.get("tab")');
    expect(read("src/pages/Dashboard.tsx")).not.toContain('"/warehouse-reports"');
    expect(read("src/components/Layout.tsx")).not.toContain('"/warehouse-reports"');
    // Внутри вкладки нет своего заголовка страницы и своих плиток — они наверху.
    const rep = read("src/pages/WarehouseReports.tsx");
    expect(rep).not.toContain("<h1");
    expect(rep).not.toContain("function KpiCard(");
    expect(rep).toContain('data-testid="valuation-strip"');
  });

  it("Layout рисует строки из navRows: заголовок группы с aria-expanded, пункты внутри — .nested без значка", () => {
    const layout = read("src/components/Layout.tsx");
    expect(layout).toContain("navRows(items, location.pathname, openGroup)");
    expect(layout).toContain("aria-expanded={row.open}");
    expect(layout).toContain("onClick={() => setOpenGroup(row.open ? null : row.key)}");
    expect(layout).toContain("{!nested && Icon && <Icon");
    expect(read("src/index.css")).toContain(".sidebar-nav-item.nested {");
  });
});
