import { memo, useMemo, useState } from "react";
import { Users, FileDown, Package } from "lucide-react";
import { F, COLORS, tableMinWidth, thStyle, tdStyle } from "./report-constants";
import { GlassPanel, SectionError } from "./ReportCharts";
import { formatQty } from "@/lib/format";
import { unitShort } from "@/lib/units";
import { PremiumSelect } from "@/components/PremiumSelect";

export interface AgentProductRow {
  agentId: number | null;
  agentName: string | null;
  productId: number | null;
  productName: string | null;
  productCode: string | null;
  unit: string | null;
  totalQty: string;
  totalRevenue: string;
  orderCount: number;
}

interface AgentProductsTabProps {
  rows: AgentProductRow[] | undefined;
  isLoading: boolean;
  isError?: boolean;
  onRetry?: () => void;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  fmt: (v: string | number) => string;
  t: (ru: string, uz: string) => string;
  onExport: () => void;
}

// 44 точки — как в карточках отчётов рядом: базовый шрифт 14px, и поле с
// отступом 8px выходило 33 точки высотой. Здесь стоят два поля даты подряд,
// и промахнуться мимо любого из них было проще, чем попасть.
const inputStyle: React.CSSProperties = {
  padding: "8px 12px", minHeight: "44px", fontSize: "13px", fontFamily: F.body, borderRadius: "10px",
  border: `1px solid ${COLORS.border}`, background: COLORS.surface, color: COLORS.textPrimary,
};

export const AgentProductsTab = memo(function AgentProductsTab({
  rows, isLoading, isError, onRetry, dateFrom, dateTo, onDateFromChange, onDateToChange, fmt, t, onExport,
}: AgentProductsTabProps) {
  const [agentFilter, setAgentFilter] = useState<string>("all");

  const agentOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows ?? []) {
      const id = String(r.agentId ?? "0");
      map.set(id, r.agentName ?? t("Не назначен", "Tayinlanmagan"));
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows, t]);

  const grouped = useMemo(() => {
    const filtered = (rows ?? []).filter(r => agentFilter === "all" || String(r.agentId ?? "0") === agentFilter);
    const byAgent = new Map<string, { key: string; agentName: string; rows: AgentProductRow[]; totalQty: number; totalRevenue: number }>();
    for (const r of filtered) {
      const key = String(r.agentId ?? "0");
      const entry = byAgent.get(key) ?? { key, agentName: r.agentName ?? t("Не назначен", "Tayinlanmagan"), rows: [], totalQty: 0, totalRevenue: 0 };
      entry.rows.push(r);
      entry.totalQty += Number(r.totalQty);
      entry.totalRevenue += Number(r.totalRevenue);
      byAgent.set(key, entry);
    }
    return [...byAgent.values()]
      .map(a => ({
        ...a,
        // Порядок задаётся здесь, один раз на загрузку данных.
        //
        // Ниже в разметке стоял `agent.rows.sort(...)` прямо в render: sort
        // правит массив на месте, а этот массив — тот самый, что лежит в кэше
        // запроса. То есть отрисовка молча переставляла данные под соседними
        // потребителями и делала это заново на каждый ререндер.
        rows: a.rows.slice().sort((x, y) => Number(y.totalRevenue) - Number(x.totalRevenue)),
      }))
      .sort((a, b) => b.totalRevenue - a.totalRevenue);
  }, [rows, agentFilter, t]);

  const grandTotal = grouped.reduce((s, a) => s + a.totalRevenue, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <GlassPanel style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px", padding: "18px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          {/* Значок цветом на бледной подложке, а не белым по заливке:
              «#fff» на цветном фоне — тот же приём, что уже подводил в
              брендинге, когда фирменный цвет арендатора оказывался светлым. */}
          <div style={{
            width: "40px", height: "40px", borderRadius: "12px", flexShrink: 0,
            background: "var(--kpi-blue-track)", color: "var(--kpi-blue)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Users size={18} aria-hidden />
          </div>
          <div>
            <p style={{ fontFamily: F.body, fontSize: "14px", fontWeight: 600, color: COLORS.textPrimary, margin: 0 }}>
              {t("Продажи по агентам и товарам", "Agent va mahsulot bo'yicha sotuvlar")}
            </p>
            <p style={{ fontSize: "12px", color: COLORS.textTertiary, margin: "2px 0 0" }}>
              {t("Кто сколько какого товара продал", "Kim qancha qaysi mahsulotni sotgan")}
            </p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          {/* max/min не давали выбрать перевёрнутый промежуток в карточках
              отчётов, а здесь их не было: «с 30 сентября по 1 сентября»
              отдавало пустой ответ, который выглядел как «продаж не было». */}
          <input type="date" value={dateFrom} max={dateTo} onChange={e => onDateFromChange(e.target.value)}
            aria-label={t("С даты", "Sanadan")} style={inputStyle} />
          <span aria-hidden style={{ color: COLORS.textTertiary, fontSize: "13px" }}>—</span>
          <input type="date" value={dateTo} min={dateFrom} onChange={e => onDateToChange(e.target.value)}
            aria-label={t("По дату", "Sanagacha")} style={inputStyle} />
          <PremiumSelect
            value={agentFilter}
            onChange={setAgentFilter}
            width="170px"
            aria-label={t("Агент", "Agent")}
            options={[
              { value: "all", label: t("Все агенты", "Barcha agentlar") },
              ...agentOptions.map(([id, name]) => ({ value: id, label: name })),
            ]}
          />
          <button type="button" onClick={onExport} className="neo-btn neo-btn-sm tap" style={{ padding: "0 14px" }}>
            <FileDown size={13} aria-hidden /> Excel
          </button>
        </div>
      </GlassPanel>

      {/* Отказ показывался как «Нет данных за период» — то есть упавший
          запрос выглядел ровно как честный ответ «за эти даты не продавали».
          Директор в такой день делает вывод о работе агентов, а не о сети. */}
      {isError && onRetry ? (
        <SectionError onRetry={onRetry} t={t} />
      ) : isLoading ? (
        <p style={{ color: COLORS.textSecondary, fontSize: "13px", textAlign: "center", padding: "32px 0" }}>
          {t("Загрузка…", "Yuklanmoqda…")}
        </p>
      ) : grouped.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0" }}>
          <Package size={32} style={{ color: COLORS.textTertiary, margin: "0 auto 12px", opacity: 0.3 }} aria-hidden />
          <p style={{ fontSize: "14px", color: COLORS.textSecondary }}>
            {agentFilter === "all"
              ? t("За выбранные даты продаж не было", "Tanlangan sanalarda sotuv bo'lmagan")
              : t("У этого агента за выбранные даты продаж не было", "Bu agentda tanlangan sanalarda sotuv bo'lmagan")}
          </p>
        </div>
      ) : (
        grouped.map(agent => {
          const share = grandTotal > 0 ? (agent.totalRevenue / grandTotal) * 100 : 0;
          return (
            // Ключ — по идентификатору агента, а не по имени: двух Азизов в
            // списке React считал одной и той же панелью.
            <GlassPanel key={agent.key}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px", flexWrap: "wrap", gap: "8px" }}>
                <h2 style={{ fontFamily: F.display, fontSize: "15px", fontWeight: 700, color: COLORS.textPrimary, margin: 0 }}>
                  {agent.agentName}
                </h2>
                <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                  <span style={{ fontSize: "12px", color: COLORS.textTertiary }}>
                    {t("Позиций", "Pozitsiya")}: <b style={{ color: COLORS.textPrimary }}>{agent.rows.length}</b>
                  </span>
                  <span style={{ fontSize: "12px", color: COLORS.textTertiary }}>
                    {t("Кол-во", "Miqdor")}: <b style={{ color: COLORS.textPrimary }}>{formatQty(agent.totalQty)}</b>
                  </span>
                  <span style={{ fontFamily: F.display, fontSize: "16px", fontWeight: 700, color: COLORS.primaryText }}>
                    {fmt(agent.totalRevenue)}
                  </span>
                  <span style={{ fontSize: "11px", color: COLORS.textTertiary }}>({share.toFixed(1)}%)</span>
                </div>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", minWidth: tableMinWidth, borderCollapse: "separate", borderSpacing: 0 }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>{t("Товар", "Mahsulot")}</th>
                      <th style={thStyle}>{t("Код", "Kod")}</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>{t("Кол-во", "Miqdor")}</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>{t("Заказов", "Buyurtma")}</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>{t("Сумма", "Summa")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agent.rows.map((r, i) => (
                      <tr key={r.productId ?? `${r.productName}-${i}`}>
                        <td style={tdStyle}>{r.productName ?? t("Без товара", "Mahsulotsiz")}</td>
                        <td style={{ ...tdStyle, color: COLORS.textTertiary, fontSize: "12px" }}>{r.productCode ?? "—"}</td>
                        {/* Единица печаталась кодом из базы — «pcs», «box»,
                            «pack». Это те же внутренние слова, из-за которых
                            выгрузку движений назвали нечитаемой; словарь на
                            них один и лежит в lib/units. */}
                        <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                          {formatQty(r.totalQty)} {unitShort(r.unit)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.orderCount}</td>
                        <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600, color: COLORS.primaryText, fontVariantNumeric: "tabular-nums" }}>
                          {fmt(r.totalRevenue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </GlassPanel>
          );
        })
      )}
    </div>
  );
});
