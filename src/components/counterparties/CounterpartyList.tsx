import { AlertTriangle, Phone, Package } from "lucide-react";
import { format } from "date-fns";
import { F, COLORS, SHADOW, money } from "./constants";

export interface CounterpartyRow {
  id: number;
  name: string;
  contactName: string | null;
  phone: string | null;
  inn: string | null;
  address: string | null;
  notes: string | null;
  status: string;
  debtUzs: number;
  debtUsd: number;
  overdueCount: number;
  suppliesCount: number;
  lastPaymentAt: string | null;
}

/**
 * Список контрагентов с долгом.
 *
 * Долг — две колонки, а не одна: сумы и доллары нельзя сложить в одно число,
 * а показать «итого» одной суммой значило бы напечатать неверную цифру. У кого
 * долларового долга нет — в колонке прочерк, и она не мешает.
 */
export function CounterpartyList({ rows, lang, onOpen }: {
  rows: CounterpartyRow[];
  lang: string;
  onOpen: (id: number) => void;
}) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const th: React.CSSProperties = {
    fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase",
    letterSpacing: "0.08em", color: COLORS.textTertiary, padding: "14px 16px",
    borderBottom: `1px solid ${COLORS.border}`, textAlign: "left", whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = {
    padding: "14px 16px", borderBottom: `1px solid ${COLORS.border}`,
    fontSize: "13px", fontFamily: F.body, color: COLORS.textPrimary,
  };

  return (
    <div style={{ background: COLORS.surface, borderRadius: "24px", boxShadow: SHADOW, overflow: "hidden", animation: "slideUp 0.5s ease forwards" }}>
      {/* Таблица уезжает вбок на узком экране в своём контейнере, а не тянет
          за собой всю страницу: шесть денежных колонок в 375px не помещаются
          и сжимать их до нечитаемости хуже, чем прокрутить. */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, minWidth: "760px" }}>
          <thead>
            <tr>
              {[
                t("КОНТРАГЕНТ", "KONTRAGENT"),
                t("ТЕЛЕФОН", "TELEFON"),
                t("ПОСТАВОК", "YETKAZIB BERISH"),
                t("ДОЛГ, СУМ", "QARZ, SO'M"),
                t("ДОЛГ, $", "QARZ, $"),
                t("ПОСЛЕДНИЙ ПЛАТЁЖ", "OXIRGI TO'LOV"),
              ].map(h => <th key={h} style={th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", padding: "48px 16px", color: COLORS.textTertiary, fontSize: "14px" }}>
                  {t("Контрагентов нет", "Kontragentlar yo'q")}
                </td>
              </tr>
            ) : rows.map(r => (
              <tr
                key={r.id}
                data-testid={`counterparty-row-${r.id}`}
                style={{ transition: "background 0.15s", cursor: "pointer" }}
                onClick={() => onOpen(r.id)}
                onMouseEnter={e => (e.currentTarget.style.background = "color-mix(in srgb, var(--color-primary) 2%, transparent)")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                <td style={{ ...td, fontWeight: 500 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span>{r.name}</span>
                    {r.overdueCount > 0 && (
                      <span
                        title={t("Есть просроченные поставки", "Muddati o'tgan yetkazib berishlar bor")}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: "4px",
                          fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "8px",
                          background: "color-mix(in srgb, var(--color-danger) 10%, transparent)",
                          color: COLORS.dangerText, whiteSpace: "nowrap",
                        }}
                      >
                        <AlertTriangle size={11} /> {r.overdueCount}
                      </span>
                    )}
                  </div>
                  {r.contactName && (
                    <div style={{ fontSize: "11px", color: COLORS.textTertiary, marginTop: "2px" }}>{r.contactName}</div>
                  )}
                </td>
                <td style={{ ...td, color: COLORS.textSecondary, whiteSpace: "nowrap" }}>
                  {r.phone
                    ? <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}><Phone size={12} />{r.phone}</span>
                    : "—"}
                </td>
                <td style={{ ...td, color: COLORS.textSecondary }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    <Package size={12} />{r.suppliesCount}
                  </span>
                </td>
                <td style={{ ...td, fontWeight: 700, whiteSpace: "nowrap", color: r.debtUzs > 0 ? COLORS.dangerText : COLORS.textTertiary }}>
                  {r.debtUzs > 0 ? money(r.debtUzs, "UZS") : "—"}
                </td>
                <td style={{ ...td, fontWeight: 700, whiteSpace: "nowrap", color: r.debtUsd > 0 ? COLORS.dangerText : COLORS.textTertiary }}>
                  {r.debtUsd > 0 ? money(r.debtUsd, "USD") : "—"}
                </td>
                <td style={{ ...td, color: COLORS.textSecondary, whiteSpace: "nowrap" }}>
                  {r.lastPaymentAt ? format(new Date(r.lastPaymentAt), "dd.MM.yyyy") : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
