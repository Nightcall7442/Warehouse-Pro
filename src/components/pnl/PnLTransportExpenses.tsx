import React from "react";
import { format } from "date-fns";
import { F, COLORS, thStyle, tdStyle } from "./styles";

interface Arrival {
  id: string;
  arrivalNumber: string;
  arrivalDate: string | null;
  truckId: string | null;
  fuelCost: number;
  tollCost: number;
  totalExpense: number;
  status: string;
}

interface PnLTransportExpensesProps {
  arrivals: Arrival[] | undefined;
  fmt: (value: number) => string;
  lang: string;
}

export function PnLTransportExpenses({
  arrivals,
  fmt,
  lang,
}: PnLTransportExpensesProps) {
  const completedArrivals = (Array.isArray(arrivals) ? arrivals : []).filter(
    (a) => a.status === "completed"
  );

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
        {lang === "uz" ? "Transport xarajatlari" : "Расходы на транспорт"}
      </h2>
      {completedArrivals.length === 0 ? (
        <p
          style={{
            color: COLORS.textSecondary,
            fontSize: "13px",
            textAlign: "center",
            padding: "32px 0",
          }}
        >
          {lang === "uz"
            ? "Ma'lumot yo'q"
            : "Нет завершённых приходов за период"}
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}
          >
            <thead>
              <tr>
                <th style={thStyle}>
                  {lang === "uz" ? "Kirim" : "Приход"}
                </th>
                <th style={thStyle}>{lang === "uz" ? "Sana" : "Дата"}</th>
                <th style={thStyle}>
                  {lang === "uz" ? "Mashina" : "Машина"}
                </th>
                <th style={{ ...thStyle, textAlign: "right" }}>
                  {lang === "uz" ? "Yoqilg'i" : "Топливо"}
                </th>
                <th style={{ ...thStyle, textAlign: "right" }}>
                  {lang === "uz" ? "Yo'l" : "Дорога"}
                </th>
                <th style={{ ...thStyle, textAlign: "right" }}>
                  {lang === "uz" ? "Jami" : "Итого"}
                </th>
              </tr>
            </thead>
            <tbody>
              {completedArrivals.slice(0, 20).map((a) => (
                <tr
                  key={a.id}
                  style={{ transition: "background 0.15s" }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background =
                      "rgba(75,108,246,0.02)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  <td style={{ ...tdStyle, fontWeight: 500 }}>
                    {a.arrivalNumber}
                  </td>
                  <td style={{ ...tdStyle, color: COLORS.textSecondary }}>
                    {a.arrivalDate
                      ? format(new Date(a.arrivalDate), "dd.MM.yyyy")
                      : "—"}
                  </td>
                  <td style={{ ...tdStyle, color: COLORS.textSecondary }}>
                    {a.truckId ?? "—"}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    {fmt(a.fuelCost)}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    {fmt(a.tollCost)}
                  </td>
                  <td
                    style={{
                      ...tdStyle,
                      textAlign: "right",
                      fontWeight: 700,
                      color: "#e85050",
                    }}
                  >
                    {fmt(a.totalExpense)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
