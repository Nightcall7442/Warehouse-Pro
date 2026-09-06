import { F, COLORS, thStyle, tdStyle, numeric, marginTone } from "./styles";
import { SectionNotice } from "@/components/SectionNotice";

// SUM()/COALESCE() come back from MySQL as decimal strings, and the product
// name is null-able through the LEFT JOIN — see analytics.cogsByProduct.
interface CogsByProductRow {
  productName: string | null;
  totalQty: string;
  totalRevenue: string;
  totalCost: string;
}

interface PnLExpenseBreakdownProps {
  cogsByProduct: CogsByProductRow[] | undefined;
  error?: boolean;
  onRetry?: () => void;
  fmt: (value: string | number) => string;
  lang: string;
}

/**
 * Вклад товара в прибыль — полоской.
 *
 * Числа в колонке отвечают «сколько», но не «во сколько раз»: чтобы понять, что
 * первый товар даёт вдвое больше второго, приходилось делить в уме двадцать
 * раз. Полоска показывает это длиной. Ось у неё посередине только тогда, когда
 * в списке есть убыточные товары: иначе половина ширины ушла бы под пустоту.
 */
function ContributionBar({ value, max, diverging }: { value: number; max: number; diverging: boolean }) {
  const share = max > 0 ? Math.min(1, Math.abs(value) / max) : 0;
  const ink = value >= 0 ? "var(--color-success)" : "var(--color-danger)";
  const width = `${share * (diverging ? 50 : 100)}%`;

  return (
    <div style={{ position: "relative", height: "8px", width: "100%", minWidth: "72px" }}>
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: diverging ? (value >= 0 ? "50%" : undefined) : 0,
          right: diverging && value < 0 ? "50%" : undefined,
          width,
          borderRadius: "4px",
          background: ink,
        }}
      />
      {diverging && (
        <div
          style={{
            position: "absolute",
            top: "-2px",
            bottom: "-2px",
            left: "50%",
            width: "1px",
            background: COLORS.border,
          }}
        />
      )}
    </div>
  );
}

export function PnLExpenseBreakdown({
  cogsByProduct,
  error,
  onRetry,
  fmt,
  lang,
}: PnLExpenseBreakdownProps) {
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);

  const rows = (cogsByProduct ?? [])
    .map((p) => {
      const revenue = Number(p.totalRevenue);
      const cost = Number(p.totalCost);
      const profit = revenue - cost;
      return {
        // Товар мог быть удалён — LEFT JOIN отдаёт по нему null, и в таблице
        // оставалась пустая ячейка без всякого объяснения.
        name: p.productName ?? t("Без названия", "Nomsiz"),
        qty: Number(p.totalQty),
        revenue,
        cost,
        profit,
        margin: revenue > 0 ? (profit / revenue) * 100 : 0,
      };
    })
    // Вопрос раздела — «на чём заработали», значит первым идёт то, что
    // принесло больше всего. Сервер сортирует по выручке, а выручка и
    // прибыль — разные списки: самый ходовой товар бывает самым бесприбыльным.
    .sort((a, b) => b.profit - a.profit);

  const maxProfit = Math.max(0, ...rows.map((r) => Math.abs(r.profit)));
  const diverging = rows.some((r) => r.profit < 0);
  const totalProfit = rows.reduce((s, r) => s + r.profit, 0);

  return (
    <div className="neo-card neo-card-static" style={{ padding: "24px" }}>
      <h2
        style={{
          fontFamily: F.display,
          fontSize: "16px",
          fontWeight: 600,
          color: COLORS.textPrimary,
          margin: "0 0 4px",
        }}
      >
        {t("На чём заработали", "Nimadan foyda")}
      </h2>
      {/* Сервер отдаёт не все товары, а двадцать лучших по выручке (LIMIT 20).
          Раздел выглядел полным списком, и итог по нему не сходился с выручкой
          вверху страницы — теперь об этом сказано прямо. */}
      <p style={{ margin: "0 0 20px", fontSize: "12px", color: COLORS.textTertiary }}>
        {t(
          "До 20 товаров с наибольшей выручкой, по убыванию прибыли",
          "Tushumi eng katta 20 tagacha mahsulot, foyda bo'yicha"
        )}
      </p>

      {error ? (
        <SectionNotice
          kind="error"
          message={t("Не удалось загрузить разбивку по товарам.", "Mahsulotlar bo'yicha ma'lumot yuklanmadi.")}
          onRetry={onRetry}
          retryLabel={t("Повторить", "Qayta urinish")}
        />
      ) : rows.length === 0 ? (
        <SectionNotice
          kind="empty"
          message={t("За выбранный период товары не продавались.", "Tanlangan davrda mahsulot sotilmagan.")}
        />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
            <thead>
              <tr>
                <th style={thStyle}>{t("Товар", "Mahsulot")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("Объём", "Hajm")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("Выручка", "Daromad")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("Себестоимость", "Tannarx")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("Прибыль", "Foyda")}</th>
                <th style={{ ...thStyle, width: "140px" }}>{t("Вклад", "Ulush")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("Маржа", "Marja")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => {
                const tone = marginTone(p.margin);
                return (
                  <tr
                    key={`${p.name}-${i}`}
                    style={{ transition: "background 0.15s" }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background =
                        "color-mix(in srgb, var(--color-primary) 4%, transparent)")
                    }
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <td style={{ ...tdStyle, fontSize: "13px", fontWeight: 500 }}>{p.name}</td>
                    <td style={{ ...tdStyle, ...numeric, color: COLORS.textSecondary }}>
                      {p.qty.toFixed(0)}
                    </td>
                    <td style={{ ...tdStyle, ...numeric, fontWeight: 600 }}>{fmt(p.revenue)}</td>
                    <td style={{ ...tdStyle, ...numeric, color: COLORS.textSecondary }}>
                      {fmt(p.cost)}
                    </td>
                    <td
                      style={{
                        ...tdStyle,
                        ...numeric,
                        fontWeight: 700,
                        color:
                          p.profit >= 0 ? "var(--color-success-text)" : "var(--color-danger-text)",
                      }}
                    >
                      {fmt(p.profit)}
                    </td>
                    <td style={tdStyle}>
                      <ContributionBar value={p.profit} max={maxProfit} diverging={diverging} />
                    </td>
                    <td style={{ ...tdStyle, ...numeric }}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 8px",
                          borderRadius: "6px",
                          fontSize: "12px",
                          fontWeight: 600,
                          fontVariantNumeric: "tabular-nums",
                          ...tone,
                        }}
                      >
                        {p.margin.toFixed(0)}%
                      </span>
                    </td>
                  </tr>
                );
              })}
              <tr style={{ background: COLORS.surfaceLight }}>
                <td
                  colSpan={4}
                  style={{ ...tdStyle, fontWeight: 700, borderTop: `2px solid ${COLORS.border}` }}
                >
                  {/* «ИТОГО» здесь было бы неправдой: это сумма по двадцати
                      товарам, а не по всем, и считается она от количества,
                      отгруженного по цене прайса, — со скидками в выручке
                      наверху страницы она не сойдётся. */}
                  {t(`Прибыль по ${rows.length} показанным товарам`, `Ko'rsatilgan ${rows.length} mahsulot foydasi`)}
                </td>
                <td
                  style={{
                    ...tdStyle,
                    ...numeric,
                    fontWeight: 700,
                    borderTop: `2px solid ${COLORS.border}`,
                    color:
                      totalProfit >= 0 ? "var(--color-success-text)" : "var(--color-danger-text)",
                  }}
                >
                  {fmt(totalProfit)}
                </td>
                <td colSpan={2} style={{ ...tdStyle, borderTop: `2px solid ${COLORS.border}` }} />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
