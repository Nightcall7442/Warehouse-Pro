/**
 * Осмотр веба по снимкам CI 19.09.2026 — мелочи, которые читались как
 * «дёшево» или врали.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NAV_ITEMS } from "@/const";

const SRC = join(__dirname, "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

describe("боковое меню", () => {
  it("у каждого пункта меню есть значок в карте Layout — «Возвраты» стояли без значка", () => {
    const layout = read("components/Layout.tsx");
    const start = layout.indexOf("const iconMap");
    // Без комментариев: имя значка в пояснении — не значок в карте.
    const map = layout.slice(start, layout.indexOf("\n};", start)).split("\n").filter(l => !l.trim().startsWith("//")).join("\n");
    const names = new Set(map.match(/\b[A-Z][A-Za-z0-9]+\b/g) ?? []);
    const missing = new Set<string>();
    for (const items of Object.values(NAV_ITEMS)) for (const it of items) if (!names.has(it.icon)) missing.add(it.icon);
    expect([...missing]).toEqual([]);
  });
});

describe("числа и подписи", () => {
  it("товары: «↘ 100 %» у низкого остатка снято; масса «1 кг = 1 кг» не показывается", () => {
    expect(read("pages/Products.tsx")).not.toContain("delta={lowStockCount > 0 ? -100 : 0}");
    expect(read("components/products/ProductCard.tsx")).toContain('!(p.unit === "kg" && Number(p.unitWeight) === 1)');
  });

  it("KPI: длинная сумма не наезжает на кольцо — minWidth 0 и короткая форма денег", () => {
    const kpi = read("pages/AgentKpi.tsx");
    expect(kpi).toContain("<div style={{ flex: 1, minWidth: 0 }}>");
    expect(kpi).toContain("value={fmt(totalRevenue, true)}");
  });

  it("отчёты: даты оси — «21.08», не «2026-08-21»", () => {
    expect(read("components/reports/OverviewTab.tsx")).toContain("tickFormatter={shortDate}");
  });

  it("склад: плитки одной высоты (без button среди div), кнопка без жаргона «Добить стоки»", () => {
    const wh = read("pages/Warehouse.tsx");
    expect(wh).not.toContain("const Wrapper = k.onClick ? 'button' : 'div';");
    expect(wh).not.toContain("Добить стоки");
  });
});
