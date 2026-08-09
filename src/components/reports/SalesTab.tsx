import { memo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from "recharts";
import { Package } from "lucide-react";
import { F, COLORS, PAYMENT_MAP, thStyle, tdStyle } from "./report-constants";
import { ChartPanel, GlassPanel } from "./ReportCharts";

interface SalesTabProps {
  shopChartData: { name: string; revenue: number; fullName: string }[];
  byPayment: { method: string; revenue: number; orderCount: number }[] | undefined;
  topProds: { productName: string; productCode?: string; totalQty: number; totalRevenue: number }[] | undefined;
  totalRevenue: number;
  fmt: (v: string | number, short?: boolean) => string;
  t: (ru: string, uz: string) => string;
}

export const SalesTab = memo(function SalesTab({
  shopChartData, byPayment, topProds, totalRevenue, fmt, t,
}: SalesTabProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* Chart */}
      <ChartPanel title={t("Продажи по магазинам", "Do'konlar bo'yicha sotuvlar")}>
        {!shopChartData.length ? (
          <p style={{ color: COLORS.textSecondary, fontSize: "13px", textAlign: "center", padding: "40px 0" }}>
            {t("Нет данных за период", "Davr uchun ma'lumot yo'q")}
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={shopChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
              <XAxis dataKey="name" tick={{ fill: COLORS.textTertiary, fontSize: 11, fontFamily: F.body }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: COLORS.textTertiary, fontSize: 11, fontFamily: F.body }} axisLine={false} tickLine={false} tickFormatter={v => fmt(v, true)} />
              <Tooltip contentStyle={{ background: COLORS.surface, border: "none", borderRadius: 12, boxShadow: "0 4px 12px rgba(0,0,0,.08)" }} cursor={{ fill: COLORS.surfaceLight }} />
              <Bar dataKey="revenue" name={t("Выручка", "Tushum")} radius={[6, 6, 0, 0]} maxBarSize={48}>
                {shopChartData.map((_, i) => {
                  const palette = ["var(--kpi-indigo)", "var(--kpi-teal)", "var(--kpi-coral)", "var(--kpi-amber)", "var(--kpi-blue)", "var(--kpi-purple)", "var(--kpi-green)"];
                  return <Cell key={i} fill={palette[i % palette.length]} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartPanel>

      {/* Payment method breakdown */}
      {byPayment && byPayment.length > 0 && (
        <GlassPanel>
          <h2 style={{ fontFamily: F.display, fontSize: "15px", fontWeight: 600, color: COLORS.textPrimary, margin: "0 0 16px" }}>
            {t("По методам оплаты", "To'lov usullari bo'yicha")}
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "10px" }}>
            {byPayment.map((p) => {
              const pm = PAYMENT_MAP[p.method] ?? { label: p.method, color: COLORS.textTertiary };
              return (
                <div key={p.method} className="neo-card-sm" style={{ padding: "14px", textAlign: "center" }}>
                  <div style={{ width: "10px", height: "10px", borderRadius: "3px", background: pm.color, margin: "0 auto 8px" }} />
                  <p style={{ fontSize: "11px", fontWeight: 600, color: COLORS.textSecondary, margin: 0 }}>{pm.label}</p>
                  <p style={{ fontFamily: F.display, fontSize: "18px", fontWeight: 700, color: COLORS.textPrimary, margin: "4px 0" }}>{fmt(p.revenue, true)}</p>
                  <p style={{ fontSize: "11px", color: COLORS.textTertiary, margin: 0 }}>{p.orderCount} {t("заказов", "buyurtma")}</p>
                </div>
              );
            })}
          </div>
        </GlassPanel>
      )}

      {/* Top products table */}
      <GlassPanel>
        <h2 style={{ fontFamily: F.display, fontSize: "15px", fontWeight: 600, color: COLORS.textPrimary, margin: "0 0 16px" }}>
          {t("Топ товаров", "Top mahsulotlar")}
        </h2>
        {!topProds?.length ? (
          <p style={{ color: COLORS.textSecondary, fontSize: "13px", textAlign: "center", padding: "32px 0" }}>
            {t("Нет данных", "Ma'lumot yo'q")}
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
              <thead>
                <tr>
                  <th style={thStyle}>{t("Товар", "Mahsulot")}</th>
                  <th style={thStyle}>{t("Код", "Kod")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("Объём", "Hajm")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("Выручка", "Tushum")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("Доля", "Ulush")}</th>
                </tr>
              </thead>
              <tbody>
                {topProds.map((p, i) => {
                  const share = totalRevenue > 0 ? (Number(p.totalRevenue) / totalRevenue) * 100 : 0;
                  return (
                    <tr key={i} style={{ transition: "background 0.15s" }} onMouseEnter={e => (e.currentTarget.style.background = "color-mix(in srgb, var(--color-primary) 2%, transparent)")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                      <td style={tdStyle}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <Package size={14} style={{ color: COLORS.primaryText, flexShrink: 0 }} />
                          <span style={{ fontSize: "13px", fontWeight: 500 }}>{p.productName}</span>
                        </div>
                      </td>
                      <td style={{ ...tdStyle, color: COLORS.textTertiary, fontSize: "12px" }}>{p.productCode ?? "—"}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{Number(p.totalQty).toFixed(0)} кг</td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600, color: COLORS.primaryText }}>{fmt(p.totalRevenue)}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "8px" }}>
                          <div style={{ width: "60px", height: "6px", background: COLORS.surfaceLight, borderRadius: "3px", overflow: "hidden" }}>
                            <div style={{ width: `${share}%`, height: "100%", background: COLORS.primary, borderRadius: "3px" }} />
                          </div>
                          <span style={{ fontSize: "12px", color: COLORS.textTertiary, width: "40px", textAlign: "right" }}>{share.toFixed(1)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </GlassPanel>
    </div>
  );
});
