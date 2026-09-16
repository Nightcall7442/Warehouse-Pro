/**
 * Одно главное действие на экран; сайдбар без третьего яруса.
 *
 * Разбор дизайна 16.09.2026: на кассе спорили две заливки — «Закрыть день»
 * в шапке и «Сохранить» в настройках; в меню роль стояла «CEO» капсом
 * фирменным цветом, а активный пункт поднимался тенью, как карточка, —
 * три яруса на одном столбце.
 *
 *   · в кассе одна заливка на экране: в самом экране — ровно одна, во
 *     вкладках — ни одной; в окнах (Modal) — по одной, окно сам себе экран;
 *   · роль в меню — словом из ROLE_LABEL на языке интерфейса, без капса;
 *   · активный пункт меню — подложка и текст фирменного цвета, без тени.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\S\r\n]*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const read = (p: string) => strip(readFileSync(join(ROOT, p), "utf8"));

/** Файл — на компоненты по объявлениям `function Name(`; считаем заливки в каждом. */
function primaryByComponent(src: string): Record<string, number> {
  const out: Record<string, number> = {};
  const parts = src.split(/\n(?=(?:export default )?function [A-Z])/);
  for (const part of parts) {
    const m = part.match(/function ([A-Za-z]+)\(/);
    if (!m) continue;
    out[m[1]] = (part.match(/neo-btn-primary/g) ?? []).length;
  }
  return out;
}

describe("касса: одно главное действие", () => {
  it("в экране — одна заливка («Закрыть день»), во вкладках — ни одной, в окнах — по одной", () => {
    const by = primaryByComponent(read("src/pages/Cash.tsx"));
    expect(by.Cash, "экран кассы").toBe(1);
    for (const tab of ["Holders", "Journal", "CashBookTab", "DaysTab", "SettingsTab"]) expect(by[tab], `вкладка ${tab}`).toBe(0);
    for (const modal of ["HandoverModal", "ExpenseModal", "AmountModal"]) expect(by[modal], `окно ${modal}`).toBe(1);
    expect(primaryByComponent(read("src/components/cash/NonCashTab.tsx")).NonCashTab, "вкладка «Безнал»").toBe(0);
  });
});

describe("сайдбар", () => {
  const layout = read("src/components/Layout.tsx");
  const css = read("src/index.css");
  it("роль — словом на языке интерфейса, не кодом капсом", () => {
    expect(layout).toContain("ROLE_LABEL[role as keyof typeof ROLE_LABEL]?.[lang]");
    expect(layout).not.toMatch(/textTransform: "uppercase"[^}]*\}\}>\{role\}/);
  });
  it("активный пункт — подложка фирменного цвета без тени; на аватаре — текстовый тон", () => {
    const active = css.slice(css.indexOf(".sidebar-nav-item.active {"), css.indexOf(".sidebar-nav-item.active::before"));
    expect(active).toContain("background: var(--color-primary-subtle);");
    expect(active).toContain("box-shadow: none;");
    expect(css).not.toMatch(/\.dark \.sidebar-nav-item\.active \{/);
    expect(layout).toContain('style={{ background: "var(--color-primary-subtle)", color: "var(--color-primary-text)" }}');
  });
});
