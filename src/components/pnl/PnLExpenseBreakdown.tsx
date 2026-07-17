import React from "react";
import { Package } from "lucide-react";
import { F, COLORS, thStyle, tdStyle } from "./styles";

interface CogsByProductRow {
  productName: string;
  totalQty: number;
  totalRevenue: number;
  totalCost: number;
}

interface PnLExpenseBreakdownProps {
  cogsByProduct: CogsByProductRow[] | undefined;
  fmt: (value: number) => string;
  lang: string;
}

export function PnLExpenseBreakdown({
  cogsByProduct,
  fmt,
  lang,
}: PnLExpenseBreakdownProps) {
  return (
    <div className="neo-card" style={{ padding: "24px" }}>
      <h2
        style={{
          fontFamily: F.display,
          fontSize: "16px",
          fontWeight: 600,
          color: COLORS.textPrimary,
          margin: "0 0 16px",
        }}
      >
        {lang === "uz"
          ? "Mahsulotlar bo'yicha foyda"
          : "Прибыль по товарам"}
      </h2>
      {!cogsByProduct || cogsByProduct.length === 0 ? (
        <p
          style={{
            color: COLORS.textSecondary,
            fontSize: "13px",
            textAlign: "center",
            padding: "32px 0",
          }}
        >
          {lang === "uz" ? "Ma'lumot yo'q" : "Нет данных за период"}
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}
          >
            <thead>
              <tr>
                <th style={thStyle}>
                  {lang === "uz" ? "Mahsulot" : "Товар"}
                </th>
                <th style={thStyle}>
                  {lang === "uz" ? "Hajm" : "Объём"}
                </th>
                <th style={{ ...thStyle, textAlign: "right" }}>
                  {lang === "uz" ? "Daromad" : "Выручка"}
                </th>
                <th style={{ ...thStyle, textAlign: "right" }}>
                  {lang === "uz" ? "COGS" : "Себестоимость"}
                </th>
                <th style={{ ...thStyle, textAlign: "right" }}>
                  {lang === "uz" ? "Foyda" : "Прибыль"}
                </th>
                <th style={{ ...thStyle, textAlign: "right" }}>
                  {lang === "uz" ? "Marja" : "Маржа"}
                </th>
              </tr>
            </thead>
            <tbody>
              {cogsByProduct.map((p, i) => {
                const revenue = Number(p.totalRevenue);
                const cost = Number(p.totalCost);
                const profit = revenue - cost;
                const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
                return (
                  <tr
                    key={i}
                    style={{ transition: "background 0.15s" }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background =
                        "rgba(75,108,246,0.02)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    <td style={tdStyle}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                        }}
                      >
                        <Package
                          size={14}
                          style={{ color: COLORS.primary, flexShrink: 0 }}
                        />
                        <span style={{ fontSize: "13px", fontWeight: 500 }}>
                          {p.productName}
                        </span>
                      </div>
                    </td>
                    <td style={{ ...tdStyle, color: COLORS.textSecondary }}>
                      {Number(p.totalQty).toFixed(0)} кг
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600 }}>
                      {fmt(revenue.toFixed(0))}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", color: "#d45050" }}>
                      {fmt(cost.toFixed(0))}
                    </td>
                    <td
                      style={{
                        ...tdStyle,
                        textAlign: "right",
                        fontWeight: 700,
                        color: profit >= 0 ? "#34c473" : "#d45050",
                      }}
                    >
                      {fmt(profit.toFixed(0))}
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
                            margin >= 20
                              ? "rgba(74,222,128,0.1)"
                              : margin >= 10
                                ? "rgba(251,191,36,0.1)"
                                : "rgba(232,80,80,0.1)",
                          color:
                            margin >= 20
                              ? "#34c473"
                              : margin >= 10
                                ? "#d4973a"
                                : "#d45050",
                        }}
                      >
                        {margin.toFixed(0)}%
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
