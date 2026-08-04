import { memo, useMemo, useState } from "react";
import { Users, FileDown, Package } from "lucide-react";
import { F, COLORS, thStyle, tdStyle } from "./report-constants";
import { GlassPanel } from "./ReportCharts";
import { formatQty } from "@/lib/format";
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
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  fmt: (v: string | number) => string;
  t: (ru: string, uz: string) => string;
  onExport: () => void;
}

const inputStyle: React.CSSProperties = {
  padding: "8px 12px", fontSize: "13px", fontFamily: F.body, borderRadius: "10px",
  border: `1px solid ${COLORS.border}`, background: COLORS.surface, color: COLORS.textPrimary,
};

export const AgentProductsTab = memo(function AgentProductsTab({
  rows, isLoading, dateFrom, dateTo, onDateFromChange, onDateToChange, fmt, t, onExport,
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
    const byAgent = new Map<string, { agentName: string; rows: AgentProductRow[]; totalQty: number; totalRevenue: number }>();
    for (const r of filtered) {
      const key = String(r.agentId ?? "0");
      const entry = byAgent.get(key) ?? { agentName: r.agentName ?? t("Не назначен", "Tayinlanmagan"), rows: [], totalQty: 0, totalRevenue: 0 };
      entry.rows.push(r);
      entry.totalQty += Number(r.totalQty);
      entry.totalRevenue += Number(r.totalRevenue);
      byAgent.set(key, entry);
    }
    return [...byAgent.values()].sort((a, b) => b.totalRevenue - a.totalRevenue);
  }, [rows, agentFilter, t]);

  const grandTotal = grouped.reduce((s, a) => s + a.totalRevenue, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <GlassPanel style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px", padding: "18px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <div style={{ width: "40px", height: "40px", borderRadius: "12px", background: "var(--kpi-blue)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Users size={18} color="#fff" />
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
          <input type="date" value={dateFrom} onChange={e => onDateFromChange(e.target.value)} style={inputStyle} />
          <span style={{ color: COLORS.textTertiary, fontSize: "13px" }}>—</span>
          <input type="date" value={dateTo} onChange={e => onDateToChange(e.target.value)} style={inputStyle} />
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
          <button onClick={onExport} style={{
            display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px",
            fontSize: "12px", fontWeight: 600, fontFamily: F.body, borderRadius: "8px",
            border: "none", cursor: "pointer", background: COLORS.surfaceLight, color: COLORS.textSecondary,
          }}>
            <FileDown size={13} /> Excel
          </button>
        </div>
      </GlassPanel>

      {isLoading ? (
        <p style={{ color: COLORS.textSecondary, fontSize: "13px", textAlign: "center", padding: "32px 0" }}>
          {t("Загрузка...", "Yuklanmoqda...")}
        </p>
      ) : grouped.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0" }}>
          <Package size={32} style={{ color: COLORS.textTertiary, margin: "0 auto 12px", opacity: 0.3 }} />
          <p style={{ fontSize: "14px", color: COLORS.textSecondary }}>{t("Нет данных за период", "Davr uchun ma'lumot yo'q")}</p>
        </div>
      ) : (
        grouped.map(agent => {
          const share = grandTotal > 0 ? (agent.totalRevenue / grandTotal) * 100 : 0;
          return (
            <GlassPanel key={agent.agentName}>
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
                  <span style={{ fontFamily: F.display, fontSize: "16px", fontWeight: 700, color: COLORS.primary }}>
                    {fmt(agent.totalRevenue)}
                  </span>
                  <span style={{ fontSize: "11px", color: COLORS.textTertiary }}>({share.toFixed(1)}%)</span>
                </div>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
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
                    {agent.rows
                      .sort((a, b) => Number(b.totalRevenue) - Number(a.totalRevenue))
                      .map((r, i) => (
                        <tr key={i}>
                          <td style={tdStyle}>{r.productName ?? t("Без товара", "Mahsulotsiz")}</td>
                          <td style={{ ...tdStyle, color: COLORS.textTertiary, fontSize: "12px" }}>{r.productCode ?? "—"}</td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>{formatQty(r.totalQty)} {r.unit ?? ""}</td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>{r.orderCount}</td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600, color: COLORS.primary }}>{fmt(r.totalRevenue)}</td>
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
