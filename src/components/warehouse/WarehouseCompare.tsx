import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { formatQty } from "@/lib/format";
import { unitShort } from "@/lib/units";
import { F, COLORS, thStyle, tdStyle } from "@/components/users/types";
import { Search } from "lucide-react";

type Warehouse = { id: number; name: string; isDefault?: boolean | null };

/**
 * Сравнение складов — товар строкой, склад колонкой.
 *
 * Прежний режим «Все склады» отдавал СУММУ по складам одной цифрой — и врал
 * дважды: продать можно только с основного, а в списке остатков строки
 * удваивались (по строке на склад). Здесь суммы нет: видно, где именно лежит
 * товар, и сколько свободно на каждом складе.
 */
export function WarehouseCompare({ warehouses }: { warehouses: Warehouse[] }) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const [search, setSearch] = useState("");
  // Без склада — по строке на каждую пару «товар × склад»; сводим здесь.
  const q = trpc.warehouseMulti.getStock.useQuery({ pageSize: 10000 });

  const rows = useMemo(() => {
    const byProduct = new Map<number, { id: number; name: string; code: string | null; unit: string | null; perWarehouse: Record<number, { available: number; current: number }> }>();
    for (const r of (q.data?.data ?? []) as Array<Record<string, unknown>>) {
      const pid = Number(r.productId);
      const row = byProduct.get(pid) ?? { id: pid, name: String(r.productName ?? ""), code: (r.productCode as string | null) ?? null, unit: (r.unit as string | null) ?? null, perWarehouse: {} };
      const wid = r.warehouseId == null ? null : Number(r.warehouseId);
      if (wid != null) row.perWarehouse[wid] = { available: Number(r.available ?? 0), current: Number(r.currentStock ?? 0) };
      byProduct.set(pid, row);
    }
    const s = search.trim().toLowerCase();
    return Array.from(byProduct.values())
      .filter(p => !s || p.name.toLowerCase().includes(s) || (p.code ?? "").toLowerCase().includes(s))
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [q.data, search]);

  const totals = useMemo(() => {
    const acc: Record<number, number> = {};
    for (const p of rows) for (const w of warehouses) acc[w.id] = (acc[w.id] ?? 0) + (p.perWarehouse[w.id]?.available ?? 0);
    return acc;
  }, [rows, warehouses]);

  return (
    <div className="space-y-4">
      <div className="relative" style={{ maxWidth: 420 }}>
        <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: COLORS.textSecondary }} />
        <input className="neo-input w-full" style={{ paddingLeft: 36 }} value={search} onChange={e => setSearch(e.target.value)}
          placeholder={t("Поиск товара…", "Mahsulot qidirish…")} data-testid="compare-search" />
      </div>
      <div className="neo-card p-0 overflow-hidden">
        <div style={{ overflowX: "auto" }}>
          <table className="w-full text-sm" data-testid="compare-table">
            <thead>
              <tr>
                <th style={thStyle}>{t("Товар", "Mahsulot")}</th>
                {warehouses.map(w => (
                  <th key={w.id} style={{ ...thStyle, textAlign: "right", whiteSpace: "nowrap" }}>
                    {w.name}{w.isDefault ? " ★" : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {q.isLoading ? (
                <tr><td style={tdStyle} colSpan={warehouses.length + 1}>{t("Загрузка…", "Yuklanmoqda…")}</td></tr>
              ) : rows.length === 0 ? (
                <tr><td style={{ ...tdStyle, color: COLORS.textTertiary }} colSpan={warehouses.length + 1}>{t("Ничего не найдено", "Hech narsa topilmadi")}</td></tr>
              ) : rows.map(p => (
                <tr key={p.id} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 600, color: COLORS.textPrimary, fontFamily: F.display }}>{p.name}</div>
                    {p.code && <div style={{ fontSize: 11.5, color: COLORS.textTertiary, fontVariantNumeric: "tabular-nums" }}>{p.code}</div>}
                  </td>
                  {warehouses.map(w => {
                    const c = p.perWarehouse[w.id];
                    const avail = c?.available ?? 0;
                    return (
                      <td key={w.id} style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", color: avail > 0 ? COLORS.textPrimary : COLORS.textTertiary }}>
                        {c ? `${formatQty(avail)} ${unitShort(p.unit, lang)}` : "—"}
                        {c && c.current !== avail && (
                          <div style={{ fontSize: 11, color: COLORS.textTertiary }}>{t("всего", "jami")} {formatQty(c.current)}</div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr style={{ borderTop: `2px solid ${COLORS.border}` }}>
                  <td style={{ ...tdStyle, fontWeight: 700 }}>{t("Свободно всего", "Jami bo'sh")}</td>
                  {warehouses.map(w => (
                    <td key={w.id} style={{ ...tdStyle, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{formatQty(totals[w.id] ?? 0)}</td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
