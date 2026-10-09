/**
 * Каталог выгрузок: что карточки «Эффективность агентов» и «Себестоимость по
 * товарам» просят у сервера.
 *
 *  П3 — «Эффективность» переводила выбранный период в «N дней», и сервер
 *       отсчитывал их назад от сейчас: файл за сентябрь нёс октябрь. Теперь —
 *       обе даты, как у соседней «Агент × Товар».
 *  П7 — «Себестоимость» не просила лимита и получала двадцать товаров
 *       экрана P&L. Теперь — все.
 *
 * Нарочные поломки: вернуть { days } — падает первый; убрать limit — второй.
 */
import { describe, it, expect, vi } from "vitest";

const calls = vi.hoisted(() => [] as Array<{ path: string; input: unknown }>);
vi.mock("@/providers/trpc", () => {
  const deep = (path: string[]): unknown => new Proxy(() => {}, {
    get: (_t, k) => (typeof k === "symbol" || k === "then" ? undefined : deep([...path, k])),
    apply: (_t, _this, args: unknown[]) => {
      const last = path[path.length - 1] ?? "";
      if (last.startsWith("use")) {
        calls.push({ path: path.slice(0, -1).join("."), input: args[0] });
        return { data: undefined };
      }
      return deep(path);
    },
  });
  return { trpc: deep([]) };
});

const { REPORTS } = await import("@/components/reports/report-registry");
const P = { from: "2026-09-01", to: "2026-09-30", territoryId: 7, category: "Напитки" };
const ask = (id: string) => {
  calls.length = 0;
  REPORTS.find(r => r.id === id)!.useQuery(P as never, { enabled: true });
  return calls[0];
};

describe("каталог выгрузок просит то, что выбрано", () => {
  it("«Эффективность агентов» — обе даты, а не «N дней»", () => {
    const c = ask("agent-efficiency");
    expect(c.path).toBe("analytics.agentEfficiency");
    expect(c.input).toMatchObject({ dateFrom: "2026-09-01", dateTo: "2026-09-30", territoryId: 7 });
    expect(c.input).not.toHaveProperty("days");
  });

  it("«Себестоимость по товарам» — все товары, а не двадцать экрана P&L", () => {
    const c = ask("cogs-by-product");
    expect(c.path).toBe("analytics.cogsByProduct");
    expect(c.input).toMatchObject({ dateFrom: "2026-09-01", dateTo: "2026-09-30", category: "Напитки" });
    expect((c.input as { limit?: number }).limit).toBeGreaterThanOrEqual(10_000);
  });
});
