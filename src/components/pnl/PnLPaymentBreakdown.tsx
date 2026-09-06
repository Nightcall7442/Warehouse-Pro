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
import {
  F,
  COLORS,
  thStyle,
  tdStyle,
  numeric,
  marginTone,
  monthLabel,
  paymentLabel,
  PAYMENT_COLORS,
  PAYMENT_ORDER,
} from "./styles";
import { ChartTooltip } from "./ChartTooltip";
import { SectionNotice } from "./SectionNotice";
import type { Lang } from "@/i18n";

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
  error?: boolean;
  trendError?: boolean;
  onRetry?: () => void;
  fmt: (value: string | number) => string;
  t: (ru: string, uz: string) => string;
  lang: Lang;
}

export function PnLPaymentBreakdown({
  paymentBreakdown,
  paymentTrend,
  error,
  trendError,
  onRetry,
  fmt,
  t,
  lang,
}: PnLPaymentBreakdownProps) {
  // Сервер группирует по способу оплаты без сортировки, и порядок строк
  // приходил произвольный. Крупнейший источник денег должен стоять первым.
  const rows = [...(paymentBreakdown ?? [])].sort((a, b) => b.revenue - a.revenue);

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalCogs = rows.reduce((s, r) => s + r.cogs, 0);
  const totalProfit = rows.reduce((s, r) => s + r.grossProfit, 0);
  const totalOrders = rows.reduce((s, r) => s + r.orderCount, 0);
  const totalMargin = totalRevenue > 0 ? ((totalRevenue - totalCogs) / totalRevenue) * 100 : 0;

  const trend = (paymentTrend ?? []).map((r) => ({ ...r, label: monthLabel(r.month, lang) }));

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
        {t("Чем платят", "Nima bilan to'laydilar")}
      </h2>
      <p style={{ margin: "0 0 20px", fontSize: "12px", color: COLORS.textTertiary }}>
        {t(
          "Выручка и маржа по способу оплаты — и как их доли менялись по месяцам",
          "To'lov usuli bo'yicha tushum va marja, oylar kesimida"
        )}
      </p>

      {/* Раньше весь раздел исчезал (return null) и когда данных нет, и когда
          запрос упал: пропавшая карточка не отличается от карточки, которой
          не должно быть. */}
      {error ? (
        <SectionNotice
          kind="error"
          message={t("Не удалось загрузить разбивку по оплате.", "To'lov bo'yicha ma'lumot yuklanmadi.")}
          onRetry={onRetry}
          retryLabel={t("Повторить", "Qayta urinish")}
        />
      ) : rows.length === 0 ? (
        <SectionNotice
          kind="empty"
          message={t("За выбранный период оплат не было.", "Tanlangan davrda to'lov bo'lmagan.")}
        />
      ) : (
        <>
          <div style={{ overflowX: "auto", marginBottom: "24px" }}>
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
              <thead>
                <tr>
                  <th style={thStyle}>{t("Способ оплаты", "To'lov usuli")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("Выручка", "Tushum")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("Себестоимость", "Tannarx")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("Прибыль", "Foyda")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("Маржа", "Marja")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("Заказов", "Buyurtma")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const tone = marginTone(row.grossMarginPct ?? 0);
                  return (
                    <tr
                      key={row.paymentMethod}
                      style={{ transition: "background 0.15s" }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background =
                          "color-mix(in srgb, var(--color-primary) 4%, transparent)")
                      }
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <td style={tdStyle}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span
                            style={{
                              width: "10px",
                              height: "10px",
                              borderRadius: "3px",
                              flexShrink: 0,
                              background: PAYMENT_COLORS[row.paymentMethod] ?? COLORS.textTertiary,
                            }}
                          />
                          <span style={{ fontSize: "13px", fontWeight: 500 }}>
                            {paymentLabel(row.paymentMethod, lang)}
                          </span>
                        </div>
                      </td>
                      <td style={{ ...tdStyle, ...numeric, fontWeight: 600 }}>
                        {fmt(row.revenue ?? 0)}
                      </td>
                      <td style={{ ...tdStyle, ...numeric, color: COLORS.textSecondary }}>
                        {fmt(row.cogs ?? 0)}
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          ...numeric,
                          fontWeight: 700,
                          color:
                            (row.grossProfit ?? 0) >= 0
                              ? "var(--color-success-text)"
                              : "var(--color-danger-text)",
                        }}
                      >
                        {fmt(row.grossProfit ?? 0)}
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
                          {(row.grossMarginPct ?? 0).toFixed(0)}%
                        </span>
                      </td>
                      <td style={{ ...tdStyle, ...numeric, color: COLORS.textSecondary }}>
                        {row.orderCount}
                      </td>
                    </tr>
                  );
                })}
                <tr style={{ background: COLORS.surfaceLight }}>
                  <td style={{ ...tdStyle, fontWeight: 700, borderTop: `2px solid ${COLORS.border}` }}>
                    {t("ИТОГО", "JAMI")}
                  </td>
                  <td style={{ ...tdStyle, ...numeric, fontWeight: 700, borderTop: `2px solid ${COLORS.border}` }}>
                    {fmt(totalRevenue)}
                  </td>
                  <td
                    style={{
                      ...tdStyle,
                      ...numeric,
                      fontWeight: 700,
                      color: COLORS.textSecondary,
                      borderTop: `2px solid ${COLORS.border}`,
                    }}
                  >
                    {fmt(totalCogs)}
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
                  <td style={{ ...tdStyle, ...numeric, fontWeight: 700, borderTop: `2px solid ${COLORS.border}` }}>
                    {totalMargin.toFixed(0)}%
                  </td>
                  <td style={{ ...tdStyle, ...numeric, fontWeight: 700, borderTop: `2px solid ${COLORS.border}` }}>
                    {totalOrders}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {trendError ? (
            <SectionNotice
              kind="error"
              message={t("Не удалось загрузить помесячные доли.", "Oylik ulushlar yuklanmadi.")}
              onRetry={onRetry}
              retryLabel={t("Повторить", "Qayta urinish")}
            />
          ) : trend.length > 0 ? (
            <div style={{ overflowX: "auto" }}>
              <div style={{ height: "300px", minWidth: `${Math.max(trend.length * 76, 360)}px` }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trend} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                    <CartesianGrid vertical={false} stroke={COLORS.border} strokeWidth={1} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: COLORS.textTertiary, fontFamily: F.body }}
                      axisLine={{ stroke: COLORS.border }}
                      tickLine={false}
                      interval={0}
                    />
                    <YAxis
                      width={64}
                      tick={{ fontSize: 11, fill: COLORS.textTertiary, fontFamily: F.body }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v: number) =>
                        new Intl.NumberFormat(lang === "uz" ? "uz" : "ru", {
                          notation: "compact",
                          maximumFractionDigits: 1,
                        }).format(v)
                      }
                    />
                    <Tooltip cursor={false} content={<ChartTooltip fmt={fmt} />} />
                    <Legend
                      iconType="circle"
                      iconSize={8}
                      wrapperStyle={{ fontSize: "12px", fontFamily: F.body, paddingTop: "12px" }}
                    />
                    {/* Порядок сегментов взят из PAYMENT_ORDER, а не из данных:
                        цвет принадлежит способу оплаты, и от того, что в этом
                        месяце не было карт, «Долг» не должен менять оттенок.

                        Обводка цветом карточки — это не рамка вокруг столбца, а
                        просвет между сегментами: два соседних цвета вплотную
                        сливаются в один блок, и граница доли не видна. */}
                    {PAYMENT_ORDER.map((key, i) => (
                      <Bar
                        key={key}
                        dataKey={key}
                        name={paymentLabel(key, lang)}
                        stackId="payment"
                        fill={PAYMENT_COLORS[key]}
                        stroke={COLORS.surface}
                        strokeWidth={1}
                        maxBarSize={28}
                        radius={i === PAYMENT_ORDER.length - 1 ? [4, 4, 0, 0] : undefined}
                        /*
                          Столбцы рисуются сразу, без анимации входа.

                          Перерисовка во время анимации (изменение ширины
                          карточки — свернули меню, потянули окно) обрывает её
                          и оставляет пустые группы: оси, сетка и легенда на
                          месте, а столбцов нет вовсе. При проверке график
                          выходил пустым каждый раз, когда карточка меняла
                          ширину на первой секунде.
                        */
                        isAnimationActive={false}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
