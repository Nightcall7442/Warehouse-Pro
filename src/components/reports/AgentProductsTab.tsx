import { memo, useMemo, useState } from "react";
import { Users, FileDown, Package } from "lucide-react";
import { F, COLORS, tableMinWidth, thStyle, tdStyle } from "./report-constants";
import { GlassPanel, SectionError } from "./ReportCharts";
import { formatQty } from "@/lib/format";
import { unitShort } from "@/lib/units";
import { PremiumSelect } from "@/components/PremiumSelect";

/*
  Деньги строки — те же, что в KPI агента и в P&L (services/agent-product-sales.ts):
  «Продажи» — после скидки заказа, «Возвраты» — проведённые в периоде,
  «Чистыми» (totalRevenue) — разница. Раньше «Сумма» была суммой строк: до
  скидки и вместе с вернувшимся товаром, — и у агента со скидками выходила
  больше его же KPI.
*/
export interface AgentProductRow {
  agentId: number | null;
  agentName: string | null;
  productId: number | null;
  productName: string | null;
  productCode: string | null;
  unit: string | null;
  totalQty: number | string;
  returnedQty?: number;
  salesRevenue?: number;
  returnedAmount?: number;
  totalRevenue: number | string;
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
    const byAgent = new Map<string, { key: string; agentName: string; rows: AgentProductRow[]; totalQty: number; totalRevenue: number; returnedAmount: number }>();
    for (const r of filtered) {
      const key = String(r.agentId ?? "0");
      const entry = byAgent.get(key) ?? { key, agentName: r.agentName ?? t("Не назначен", "Tayinlanmagan"), rows: [], totalQty: 0, totalRevenue: 0, returnedAmount: 0 };
      entry.rows.push(r);
      entry.totalQty += Number(r.totalQty);
      entry.totalRevenue += Number(r.totalRevenue);
      entry.returnedAmount += Number(r.returnedAmount ?? 0);
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

  /*
    Доля — от суммы ПОЛОЖИТЕЛЬНЫХ итогов. У агента, у которого в периоде
    только возвраты прошлых продаж, итог отрицательный: со знаковым
    знаменателем у остальных выходило «125%», а у него «−25%». Ему доля не
    показывается вовсе.
  */
  const grandTotal = grouped.reduce((s, a) => s + Math.max(0, a.totalRevenue), 0);

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
            {/* Откуда числа — одной строкой: директор сверяет этот блок с KPI
                и зарплатой, и сходиться они обязаны. */}
            <p data-testid="agent-products-basis" style={{ fontSize: "12px", color: COLORS.textTertiary, margin: "2px 0 0" }}>
              {t("Суммы — после скидки заказа, за вычетом возвратов периода, как в P&L и KPI агента",
                 "Summalar — buyurtma chegirmasidan keyin, davr qaytarishlari ayirilgan, P&L va agent KPI dagidek")}
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
          const share = grandTotal > 0 && agent.totalRevenue > 0 ? (agent.totalRevenue / grandTotal) * 100 : null;
          return (
            // Ключ — по идентификатору агента, а не по имени: двух Азизов в
            // списке React считал одной и той же панелью.
            <GlassPanel key={agent.key}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px", flexWrap: "wrap", gap: "8px" }}>
                <h2 style={{ fontFamily: F.display, fontSize: "15px", fontWeight: 700, color: COLORS.textPrimary, margin: 0 }}>
                  {agent.agentName}
                </h2>
                {/* С переносом: с «Возвратами» шапка на телефоне не помещалась
                    в строку, и доля уезжала за край карточки. */}
                <div style={{ display: "flex", alignItems: "center", gap: "6px 16px", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "12px", color: COLORS.textTertiary }}>
                    {t("Позиций", "Pozitsiya")}: <b style={{ color: COLORS.textPrimary }}>{agent.rows.length}</b>
                  </span>
                  <span style={{ fontSize: "12px", color: COLORS.textTertiary }}>
                    {t("Кол-во", "Miqdor")}: <b style={{ color: COLORS.textPrimary }}>{formatQty(agent.totalQty)}</b>
                  </span>
                  {agent.returnedAmount > 0 && (
                    <span style={{ fontSize: "12px", color: COLORS.textTertiary }}>
                      {t("Возвраты", "Qaytarish")}: <b style={{ color: "var(--color-danger-text)" }}>−{fmt(agent.returnedAmount)}</b>
                    </span>
                  )}
                  <span style={{ fontFamily: F.display, fontSize: "16px", fontWeight: 700, color: COLORS.primaryText }}>
                    {fmt(agent.totalRevenue)}
                  </span>
                  {share !== null && <span style={{ fontSize: "11px", color: COLORS.textTertiary }}>({share.toFixed(1)}%)</span>}
                  {/* Отчёт сходится с P&L и потому уходит в минус; KPI и
                      зарплата ниже нуля не опускаются. Сказать это здесь —
                      иначе «−500 000» рядом с «KPI: 0» читается как ошибка. */}
                  {agent.totalRevenue < 0 && (
                    <span data-testid="agent-returns-exceed" style={{ fontSize: "11px", color: COLORS.textTertiary }}>
                      {t("возвраты больше продаж — в KPI 0", "qaytarish sotuvdan ko'p — KPI da 0")}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", minWidth: tableMinWidth, borderCollapse: "separate", borderSpacing: 0 }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>{t("Товар", "Mahsulot")}</th>
                      <th style={thStyle}>{t("Код", "Kod")}</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>{t("Продано", "Sotildi")}</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>{t("Вернули", "Qaytdi")}</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>{t("Заказов", "Buyurtma")}</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>{t("Продажи", "Sotuv")}</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>{t("Возвраты", "Qaytarish")}</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>{t("Чистыми", "Sof")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agent.rows.map((r, i) => (
                      <tr key={r.productId ?? `${r.productName}-${i}`}>
                        <td style={tdStyle}>{r.productName ?? (r.productId == null
                          ? t("Возврат без строк товара", "Mahsulot qatorisiz qaytarish")
                          : t("Без товара", "Mahsulotsiz"))}</td>
                        <td style={{ ...tdStyle, color: COLORS.textTertiary, fontSize: "12px" }}>{r.productCode ?? "—"}</td>
                        {/* Единица печаталась кодом из базы — «pcs», «box»,
                            «pack». Это те же внутренние слова, из-за которых
                            выгрузку движений назвали нечитаемой; словарь на
                            них один и лежит в lib/units. */}
                        <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                          {formatQty(r.totalQty)} {unitShort(r.unit)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", color: Number(r.returnedQty ?? 0) > 0 ? "var(--color-danger-text)" : COLORS.textTertiary }}>
                          {Number(r.returnedQty ?? 0) > 0 ? `${formatQty(r.returnedQty ?? 0)} ${unitShort(r.unit)}` : "—"}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.orderCount}</td>
                        <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                          {fmt(r.salesRevenue ?? r.totalRevenue)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", color: Number(r.returnedAmount ?? 0) > 0 ? "var(--color-danger-text)" : COLORS.textTertiary }}>
                          {Number(r.returnedAmount ?? 0) > 0 ? `−${fmt(r.returnedAmount ?? 0)}` : "—"}
                        </td>
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
