import { memo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from "recharts";
import { Package } from "lucide-react";
import { colorMix } from "@/lib/color-mix";
import { formatQty } from "@/lib/format";
import { unitShort } from "@/lib/units";
import { F, COLORS, PAYMENT_MAP, tableMinWidth, thStyle, tdStyle } from "./report-constants";
import { ChartPanel, GlassPanel, SectionError } from "./ReportCharts";

export interface PaymentRow {
  method: string;
  revenue: number;
  orderCount: number;
  /** Валовая прибыль и маржа приходят только руководителю — на сервере это financeQuery. */
  grossProfit?: number;
  grossMarginPct?: number;
}

interface SalesTabProps {
  shopChartData: { name: string; revenue: number; fullName: string }[];
  byPayment: PaymentRow[] | undefined;
  topProds: { productName: string; productCode?: string; unit?: string | null; totalQty: number; returnedQty?: number; totalRevenue: number }[] | undefined;
  /**
   * Выручка за период целиком — знаменатель колонки «Доля».
   *
   * Здесь передавалась сумма показанных десяти товаров, и доля считалась от
   * неё: у первого товара выходило «34 %», хотя от всей выручки он давал
   * втрое меньше. Число выглядело как доля в продажах и ею не было.
   * null — итог неизвестен, тогда колонка честно молчит.
   */
  periodRevenue: number | null;
  /** Язык единиц: «шт» или «dona». */
  lang?: string;
  fmt: (v: string | number, short?: boolean) => string;
  t: (ru: string, uz: string) => string;
  errors?: { shops?: () => void; products?: () => void; payment?: () => void };
}

export const SalesTab = memo(function SalesTab({
  shopChartData, byPayment, topProds, periodRevenue, lang = "ru", fmt, t, errors,
}: SalesTabProps) {
  const shownRevenue = (topProds ?? []).reduce((s, p) => s + Number(p.totalRevenue), 0);
  const qty = (q: number, unit: string | null | undefined) => `${formatQty(q)}${unit ? ` ${unitShort(unit, lang)}` : ""}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* Chart */}
      <ChartPanel title={t("Продажи по магазинам", "Do'konlar bo'yicha sotuvlar")}>
        {errors?.shops ? (
          <SectionError onRetry={errors.shops} t={t} />
        ) : !shopChartData.length ? (
          <p style={{ color: COLORS.textSecondary, fontSize: "13px", textAlign: "center", padding: "40px 0" }}>
            {t("За период продаж не было", "Davr uchun sotuv bo'lmagan")}
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={shopChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
              <XAxis dataKey="name" tick={{ fill: COLORS.textTertiary, fontSize: 11, fontFamily: F.body }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: COLORS.textTertiary, fontSize: 11, fontFamily: F.body }} axisLine={false} tickLine={false} tickFormatter={v => fmt(v, true)} />
              <Tooltip contentStyle={{ background: COLORS.surface, border: "none", borderRadius: 12, boxShadow: "0 4px 12px rgba(0,0,0,.08)" }} cursor={false} />
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

      {/* Payment method breakdown.
          Блок целиком показывается только руководителю: на сервере
          pnlByPaymentMethod закрыт financeQuery, потому что несёт маржу. */}
      {(errors?.payment || (byPayment && byPayment.length > 0)) && (
        <GlassPanel>
          <h2 style={{ fontFamily: F.display, fontSize: "15px", fontWeight: 600, color: COLORS.textPrimary, margin: "0 0 16px" }}>
            {t("По способу оплаты", "To'lov usuli bo'yicha")}
          </h2>
          {errors?.payment ? <SectionError onRetry={errors.payment} t={t} /> : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "10px" }}>
            {(byPayment ?? []).map((p) => {
              const pm = PAYMENT_MAP[p.method] ?? { label: p.method, color: COLORS.textTertiary };
              return (
                <div key={p.method} className="neo-card-sm" style={{ padding: "14px", textAlign: "center" }}>
                  <div aria-hidden style={{ width: "10px", height: "10px", borderRadius: "3px", background: pm.color, margin: "0 auto 8px" }} />
                  <p style={{ fontSize: "11px", fontWeight: 600, color: COLORS.textSecondary, margin: 0 }}>{pm.label}</p>
                  <p style={{ fontFamily: F.display, fontSize: "18px", fontWeight: 700, color: COLORS.textPrimary, margin: "4px 0", fontVariantNumeric: "tabular-nums" }}>
                    {fmt(p.revenue, true)}
                  </p>
                  <p style={{ fontSize: "11px", color: COLORS.textTertiary, margin: 0 }}>{p.orderCount} {t("заказов", "buyurtma")}</p>
                  {/* Маржа уже приходит вместе с выручкой и раньше выбрасывалась
                      по дороге. Директору важнее не «где больше денег», а «где
                      мы на них зарабатываем»: долг может давать выручку и
                      съедать прибыль. */}
                  {p.grossMarginPct !== undefined && (
                    <p style={{ fontSize: "11px", color: COLORS.textSecondary, margin: "6px 0 0" }}>
                      {t("маржа", "marja")} <b style={{ color: COLORS.textPrimary }}>{p.grossMarginPct.toFixed(1)}%</b>
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          )}
        </GlassPanel>
      )}

      {/* Top products table */}
      <GlassPanel>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", marginBottom: "16px" }}>
          <h2 style={{ fontFamily: F.display, fontSize: "15px", fontWeight: 600, color: COLORS.textPrimary, margin: 0 }}>
            {t("Топ товаров", "Top mahsulotlar")}
          </h2>
          {!!topProds?.length && (
            <p style={{ fontSize: "12px", color: COLORS.textTertiary, margin: 0 }}>
              {/* Сколько строк показано и сколько денег в них — иначе «Доля»
                  ниже не с чем соотнести. И на какой основе: та же, что у P&L. */}
              {topProds.length} {t("позиций", "pozitsiya")} · {fmt(shownRevenue)}
              <span data-testid="top-products-basis"> · {t("после скидок, за вычетом возвратов", "chegirma va qaytarishlardan keyin")}</span>
            </p>
          )}
        </div>
        {errors?.products ? (
          <SectionError onRetry={errors.products} t={t} />
        ) : !topProds?.length ? (
          <p style={{ color: COLORS.textSecondary, fontSize: "13px", textAlign: "center", padding: "32px 0" }}>
            {t("За период продаж не было", "Davr uchun sotuv bo'lmagan")}
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: tableMinWidth, borderCollapse: "separate", borderSpacing: 0 }}>
              <thead>
                <tr>
                  <th style={thStyle}>{t("Товар", "Mahsulot")}</th>
                  <th style={thStyle}>{t("Код", "Kod")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("Продано", "Sotildi")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("Выручка", "Tushum")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>
                    {periodRevenue ? t("Доля в выручке", "Tushumdagi ulush") : t("Доля в показанных", "Ko'rsatilganlardagi ulush")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {topProds.map((p, i) => {
                  const base = periodRevenue ?? shownRevenue;
                  const share = base > 0 ? (Number(p.totalRevenue) / base) * 100 : 0;
                  return (
                    <tr key={p.productCode ?? `${p.productName}-${i}`}>
                      <td style={tdStyle}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <Package size={14} style={{ color: COLORS.primaryText, flexShrink: 0 }} aria-hidden />
                          <span style={{ fontSize: "13px", fontWeight: 500 }}>{p.productName}</span>
                        </div>
                      </td>
                      <td style={{ ...tdStyle, color: COLORS.textTertiary, fontSize: "12px" }}>{p.productCode ?? "—"}</td>
                      {/* Единица — своя у каждого товара (topProducts её
                          отдаёт), количество — с дробью: «.toFixed(0)»
                          превращал 25,5 кг в «26». Вернувшееся — строкой
                          ниже: «Выручка» уже за вычетом его денег. */}
                      <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {qty(Number(p.totalQty), p.unit)}
                        {Number(p.returnedQty) > 0 && (
                          <div style={{ fontSize: "11px", color: COLORS.textTertiary }}>
                            {t("вернули", "qaytarildi")} {qty(Number(p.returnedQty), p.unit)}
                          </div>
                        )}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600, color: COLORS.primaryText, fontVariantNumeric: "tabular-nums" }}>
                        {fmt(p.totalRevenue)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "8px" }}>
                          <div aria-hidden style={{ width: "60px", height: "6px", background: colorMix(COLORS.primary, 12), borderRadius: "3px", overflow: "hidden" }}>
                            <div style={{ width: `${Math.min(100, share)}%`, height: "100%", background: COLORS.primary, borderRadius: "3px" }} />
                          </div>
                          <span style={{ fontSize: "12px", color: COLORS.textTertiary, width: "44px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                            {share.toFixed(1)}%
                          </span>
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
