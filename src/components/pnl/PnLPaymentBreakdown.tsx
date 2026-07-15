import React from "react";
import {
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  BarChart,
} from "recharts";
import { F, COLORS, thStyle, tdStyle, PAYMENT_COLORS, PAYMENT_LABELS } from "./styles";
import { ChartTooltip } from "./ChartTooltip";

interface PaymentBreakdownRow {
  paymentMethod: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossMarginPct: number;
  orderCount: number;
}

interface PaymentTrendRow {
  month: string;
  cash: number;
  transfer: number;
  debt: number;
  card: number;
}

interface PnLPaymentBreakdownProps {
  paymentBreakdown: PaymentBreakdownRow[] | undefined;
  paymentTrend: PaymentTrendRow[] | undefined;
  fmt: (value: number) => string;
  t: (ru: string, uz: string) => string;
  lang: string;
}

export function PnLPaymentBreakdown({
  paymentBreakdown,
  paymentTrend,
  fmt,
  t,
  lang,
}: PnLPaymentBreakdownProps) {
  if (!paymentBreakdown || paymentBreakdown.length === 0) return null;

  const totalRevenue = paymentBreakdown.reduce((s, r) => s + r.revenue, 0);
  const totalCogs = paymentBreakdown.reduce((s, r) => s + r.cogs, 0);
  const totalProfit = paymentBreakdown.reduce((s, r) => s + r.grossProfit, 0);
  const totalOrders = paymentBreakdown.reduce((s, r) => s + r.orderCount, 0);
  const totalMargin = totalRevenue > 0 ? ((totalRevenue - totalCogs) / totalRevenue) * 100 : 0;

  return (
    <div className="neo-card" style={{ padding: "24px" }}>
      <h2
        style={{
          fontFamily: F.display,
          fontSize: "16px",
          fontWeight: 600,
          color: COLORS.textPrimary,
          margin: "0 0 20px",
        }}
      >
        {t("Разбивка по методам оплаты", "To'lov usullari bo'yicha")}
      </h2>

      <div style={{ overflowX: "auto", marginBottom: "24px" }}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
          <thead>
            <tr>
              <th style={thStyle}>{t("Метод оплаты", "To'lov usuli")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("Выручка", "Tushum")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("Себестоимость", "Tannarx")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("Прибыль", "Foyda")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("Маржа", "Marja")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("Заказов", "Buyurtma")}</th>
            </tr>
          </thead>
          <tbody>
            {paymentBreakdown.map((row) => (
              <tr
                key={row.paymentMethod}
                style={{ transition: "background 0.15s" }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "rgba(75,108,246,0.02)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                <td style={tdStyle}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span
                      style={{
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        background:
                          PAYMENT_COLORS[row.paymentMethod] ?? COLORS.primary,
                      }}
                    />
                    <span style={{ fontSize: "13px", fontWeight: 500 }}>
                      {PAYMENT_LABELS[row.paymentMethod]?.[lang] ??
                        row.paymentMethod}
                    </span>
                  </div>
                </td>
                <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600 }}>
                  {fmt(row.revenue.toFixed(0))}
                </td>
                <td style={{ ...tdStyle, textAlign: "right", color: "#e85050" }}>
                  {fmt(row.cogs.toFixed(0))}
                </td>
                <td
                  style={{
                    ...tdStyle,
                    textAlign: "right",
                    fontWeight: 700,
                    color: row.grossProfit >= 0 ? "#34c473" : "#e85050",
                  }}
                >
                  {fmt(row.grossProfit.toFixed(0))}
                </td>
                <td style={{ ...tdStyle, textAlign: "right" }}>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "2px 8px",
                      borderRadius: "6px",
                      fontSize: "12px",
                      fontWeight: 600,
                      background:
                        row.grossMarginPct >= 20
                          ? "rgba(74,222,128,0.1)"
                          : row.grossMarginPct >= 10
                            ? "rgba(251,191,36,0.1)"
                            : "rgba(232,80,80,0.1)",
                      color:
                        row.grossMarginPct >= 20
                          ? "#34c473"
                          : row.grossMarginPct >= 10
                            ? "#e8a830"
                            : "#e85050",
                    }}
                  >
                    {row.grossMarginPct.toFixed(0)}%
                  </span>
                </td>
                <td style={{ ...tdStyle, textAlign: "right" }}>
                  {row.orderCount}
                </td>
              </tr>
            ))}
            <tr
              style={{
                borderTop: `2px solid ${COLORS.border}`,
                background: COLORS.surfaceLight,
              }}
            >
              <td style={{ ...tdStyle, fontWeight: 700 }}>
                {t("ИТОГО", "JAMI")}
              </td>
              <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>
                {fmt(totalRevenue.toFixed(0))}
              </td>
              <td
                style={{
                  ...tdStyle,
                  textAlign: "right",
                  fontWeight: 700,
                  color: "#e85050",
                }}
              >
                {fmt(totalCogs.toFixed(0))}
              </td>
              <td
                style={{
                  ...tdStyle,
                  textAlign: "right",
                  fontWeight: 700,
                  color: "#34c473",
                }}
              >
                {fmt(totalProfit.toFixed(0))}
              </td>
              <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>
                {totalMargin.toFixed(0)}%
              </td>
              <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>
                {totalOrders}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {paymentTrend && paymentTrend.length > 0 && (
        <div style={{ height: "300px" }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={paymentTrend}
              margin={{ top: 5, right: 20, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
              <XAxis
                dataKey="month"
                tick={{
                  fontSize: 11,
                  fill: COLORS.textTertiary,
                  fontFamily: F.body,
                }}
                axisLine={{ stroke: COLORS.border }}
                tickLine={false}
              />
              <YAxis
                tick={{
                  fontSize: 11,
                  fill: COLORS.textTertiary,
                  fontFamily: F.body,
                }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) =>
                  v >= 1_000_000
                    ? `${(v / 1_000_000).toFixed(0)}M`
                    : v >= 1_000
                      ? `${(v / 1_000).toFixed(0)}K`
                      : String(v)
                }
              />
              <Tooltip content={<ChartTooltip fmt={(v) => fmt(v)} />} />
              <Legend
                iconType="circle"
                iconSize={8}
                wrapperStyle={{
                  fontSize: "12px",
                  fontFamily: F.body,
                  paddingTop: "12px",
                }}
              />
              <Bar
                dataKey="cash"
                name={t("Наличные", "Naqd")}
                stackId="payment"
                fill="#34c473"
                radius={[0, 0, 0, 0]}
              />
              <Bar
                dataKey="transfer"
                name={t("Перечисление", "O'tkazma")}
                stackId="payment"
                fill="#4b6cf6"
                radius={[0, 0, 0, 0]}
              />
              <Bar
                dataKey="debt"
                name={t("Долг", "Qarz")}
                stackId="payment"
                fill="#e8a830"
                radius={[0, 0, 0, 0]}
              />
              <Bar
                dataKey="card"
                name={t("Карта", "Plastik")}
                stackId="payment"
                fill="#9b59b6"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
