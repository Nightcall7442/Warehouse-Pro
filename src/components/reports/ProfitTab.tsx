import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Coins, FileDown, Percent, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { useIsMobile } from "@/hooks/use-mobile";
import { useUrlState, urlBool } from "@/hooks/useUrlState";
import { exportToExcel } from "@/lib/excel";
import { CardTable } from "@/components/CardTable";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import { F, COLORS, thStyle, tdStyle } from "@/components/users/types";
import { MARGIN_RULES, marginReasonText, type MarginDim } from "@contracts/margin";
import { PeriodControls, ReportTile, Segmented } from "./ReportPeriod";
import { dmy, useReportPeriod } from "./report-period";
import { BY_CODEC, DIR_CODEC, SORT_CODEC, sortMarginRows, type ProfitSort } from "./profit-sort";

/*
  «Прибыль» — раздел «Отчётов» директора.

  Вопрос, ради которого он заведён, владелец сказал сам: кто продаёт много,
  но в минус. Поэтому сверху — итог периода и сверка с P&L (одно число на
  двух страницах, а не два похожих), ниже — разрез по товарам, магазинам или
  агентам, и отдельный фильтр «В минус / низкая маржа» с причинами словами.

  Всё в адресе (?tab=profit&by=shop&alarm=1&sort=margin&dir=asc): ссылку
  «магазины в минус за сентябрь» можно переслать.

  Раздел только директору (reports.margin — financeQuery): себестоимость и
  наценка в руках поля — это то, насколько магазин может давить на цену.
*/

const FLAG_BG = { loss: "var(--color-danger-subtle)", low: "var(--color-warning-subtle)" } as const;
const FLAG_TEXT = { loss: "var(--color-danger-text)", low: "var(--color-warning-text)" } as const;

const pctText = (v: number | null) => (v == null ? "—" : `${String(v).replace(".", ",")}%`);

export function ProfitTab() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { fmt } = useCurrency();
  const navigate = useNavigate();
  const phone = useIsMobile();
  const period = useReportPeriod();
  const { from, to } = period;
  const [by, setBy] = useUrlState<MarginDim>("by", "product", BY_CODEC);
  const [alarm, setAlarm] = useUrlState("alarm", false, urlBool);
  const [sort, setSort] = useUrlState<ProfitSort>("sort", "revenue", SORT_CODEC);
  const [dir, setDir] = useUrlState<"asc" | "desc">("dir", "desc", DIR_CODEC);
  const [shown, setShown] = useState(phone ? 10 : 30);

  const q = trpc.reports.margin.useQuery({ from, to, by });
  const r = q.data;
  const money = (n: number) => fmt(n);
  // Плитка на телефоне в полэкрана: «192 723 734 сум» рвался посреди числа.
  const tile = (n: number) => fmt(n, phone);

  const rows = useMemo(() => {
    if (!r) return [];
    return sortMarginRows(alarm ? r.rows.filter(x => x.flag) : r.rows, sort, dir);
  }, [r, alarm, sort, dir]);

  const sortBy = (k: ProfitSort) => {
    if (k === sort) setDir(dir === "asc" ? "desc" : "asc");
    else { setSort(k); setDir(k === "name" ? "asc" : "desc"); }
  };

  const dimLabel = (d: MarginDim) => d === "product" ? t("Товары", "Tovarlar") : d === "shop" ? t("Магазины", "Do'konlar") : t("Агенты", "Agentlar");
  const nameHead = by === "product" ? t("ТОВАР", "TOVAR") : by === "shop" ? t("МАГАЗИН", "DO'KON") : t("АГЕНТ", "AGENT");

  // Бумага — по-русски, на каком бы языке ни был экран.
  const exportXlsx = () => {
    if (!r) return;
    const nameCol = by === "product" ? "Товар" : by === "shop" ? "Магазин" : "Агент";
    const plain = (n: number) => `${n.toLocaleString("ru-RU")} сум`;
    void exportToExcel(rows.map(x => ({
      [nameCol]: x.name,
      ...(by === "product" ? { "Код": x.sub ?? "" } : by === "shop" ? { "Город": x.sub ?? "" } : {}),
      "Выручка": x.revenue,
      "Себестоимость": x.cost,
      "Валовая прибыль": x.profit,
      "Маржа, %": x.marginPct ?? "",
      "Доля в прибыли, %": x.profitShare ?? "",
      "Тревога": x.flag === "loss" ? "В минус" : x.flag === "low" ? "Низкая маржа" : "",
      "Причины": x.reasons.map(z => marginReasonText(z, "ru", plain)).join("; "),
    })), `pribyl-${by}-${from}_${to}`, "Прибыль", `Прибыль по ${by === "product" ? "товарам" : by === "shop" ? "магазинам" : "агентам"} ${dmy(from)} — ${dmy(to)}`);
  };

  const sortHead = (k: ProfitSort, label: string, align: "left" | "right" = "left") => (
    <th key={k} style={{ ...thStyle, textAlign: align, padding: 0 }} aria-sort={sort === k ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => sortBy(k)} data-testid={`profit-sort-${k}`}
        style={{ all: "unset", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, justifyContent: align === "right" ? "flex-end" : "flex-start", padding: "12px 16px", minHeight: 44, boxSizing: "border-box", width: "100%" }}>
        {label}
        {sort === k && (dir === "asc" ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden />)}
      </button>
    </th>
  );

  return (
    <div className="space-y-4" data-testid="profit-report">
      <div className="neo-card report-filters" style={{ padding: 16 }}>
        <div className="flex flex-wrap items-end gap-3">
          <PeriodControls period={period} t={t} testid="profit" />
          <button type="button" onClick={exportXlsx} disabled={!r || rows.length === 0} className="neo-btn tap disabled:opacity-40" style={{ minHeight: 44, padding: "0 16px", gap: 7, marginLeft: "auto" }}>
            <FileDown size={15} aria-hidden />Excel
          </button>
        </div>
      </div>

      {q.isError ? <QueryErrorFallback onRetry={() => void q.refetch()} /> : !r ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map(i => <div key={i} className="rounded-3xl animate-pulse" style={{ height: 120, background: "var(--color-surface-light)" }} />)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="profit-totals">
            <ReportTile label={t("Выручка", "Tushum")} value={tile(r.totals.revenue)} sub={t("после скидок и возвратов", "chegirma va qaytarishdan keyin")} icon={<Wallet size={18} />} tone="var(--color-primary)" />
            <ReportTile label={t("Себестоимость", "Tannarx")} value={tile(r.totals.cost)} sub={t("по цене закупки в заказе", "buyurtmadagi xarid narxi bo'yicha")} icon={<Coins size={18} />} tone="var(--color-info)" />
            <ReportTile label={t("Валовая прибыль", "Yalpi foyda")} value={tile(r.totals.profit)} sub={t("до расходов и зарплаты", "xarajat va oylikdan oldin")} icon={r.totals.profit < 0 ? <TrendingDown size={18} /> : <TrendingUp size={18} />} tone={r.totals.profit < 0 ? "var(--color-danger)" : "var(--color-success)"} testid="profit-total-gross" />
            <ReportTile label={t("Средняя маржа", "O'rtacha marja")} value={pctText(r.totals.marginPct)}
              sub={r.totals.flagged > 0 ? t(`в минус или ниже ${MARGIN_RULES.LOW_MARGIN_PCT}%: ${r.totals.flagged}`, `zarar yoki ${MARGIN_RULES.LOW_MARGIN_PCT}% dan past: ${r.totals.flagged}`) : t("тревожных строк нет", "xavotirli qator yo'q")}
              icon={<Percent size={18} />} tone="var(--color-warning)" />
          </div>

          {/* ── Сверка с P&L ── */}
          <section className="neo-card flex items-start gap-3" style={{ padding: "14px 18px" }} data-testid="profit-reconcile" data-matches={r.pnl.matches ? "1" : "0"}>
            {r.pnl.matches
              ? <CheckCircle2 size={20} color="var(--color-success-text)" style={{ flexShrink: 0, marginTop: 1 }} aria-hidden />
              : <AlertTriangle size={20} color="var(--color-warning-text)" style={{ flexShrink: 0, marginTop: 1 }} aria-hidden />}
            <div className="min-w-0" style={{ fontSize: 13, color: COLORS.textSecondary, lineHeight: 1.5 }}>
              {r.pnl.matches ? (
                <>
                  <span style={{ color: COLORS.textPrimary, fontWeight: 600 }}>
                    {t(`Сходится с P&L за этот период: выручка ${fmt(r.pnl.revenue)}, себестоимость ${fmt(r.pnl.cost)}.`,
                       `Shu davr uchun P&L bilan mos: tushum ${fmt(r.pnl.revenue)}, tannarx ${fmt(r.pnl.cost)}.`)}
                  </span>{" "}
                  {t("Здесь валовая прибыль — до расходов: чистая прибыль в P&L меньше на расходы по приходам и выданную зарплату.",
                     "Bu yerda yalpi foyda — xarajatlardan oldin: P&L dagi sof foyda kirim xarajatlari va berilgan oylik qadar kamroq.")}
                </>
              ) : (
                <span style={{ color: COLORS.textPrimary }}>
                  {t(`Не сходится с P&L: там выручка ${fmt(r.pnl.revenue)} и себестоимость ${fmt(r.pnl.cost)} — больше на ${fmt(r.pnl.diff.revenue)} и ${fmt(r.pnl.diff.cost)}. В P&L есть заказы без строк товаров: их сумму не по чему разложить.`,
                     `P&L bilan mos emas: u yerda tushum ${fmt(r.pnl.revenue)}, tannarx ${fmt(r.pnl.cost)} — ${fmt(r.pnl.diff.revenue)} va ${fmt(r.pnl.diff.cost)} ko'p. P&L da tovar qatorlarisiz buyurtmalar bor: ularning summasini taqsimlab bo'lmaydi.`)}
                </span>
              )}
            </div>
            <button type="button" onClick={() => navigate("/pnl")} className="neo-btn tap flex-shrink-0" style={{ minHeight: 44, padding: "0 14px", marginLeft: "auto" }}>
              P&L
            </button>
          </section>

          {/* ── Разрез и тревога ── */}
          <div className="flex flex-wrap items-center gap-3">
            <Segmented label={t("Разрез", "Kesim")} value={by} onChange={v => { setBy(v); setShown(phone ? 10 : 30); }}
              options={(["product", "shop", "agent"] as const).map(d => ({ key: d, label: dimLabel(d) }))} />
            <button type="button" onClick={() => setAlarm(!alarm)} aria-pressed={alarm} data-testid="profit-alarm"
              className={"range-pill tap" + (alarm ? " active" : "")}
              style={{ display: "flex", alignItems: "center", gap: 7, borderRadius: 999, padding: "0 16px", minHeight: 44, background: alarm ? "var(--color-danger-subtle)" : COLORS.surface, boxShadow: alarm ? "var(--shadow-pressed)" : "var(--shadow-raised)", color: alarm ? "var(--color-danger-text)" : COLORS.textSecondary, fontWeight: 600 }}>
              <AlertTriangle size={15} aria-hidden />
              {t("В минус / низкая маржа", "Zarar / past marja")}
              <span className="font-data" style={{ fontWeight: 800 }}>{r.totals.flagged}</span>
            </button>
          </div>

          {rows.length === 0 ? (
            <div className="neo-card text-center" style={{ padding: 40, color: COLORS.textSecondary, fontSize: 14 }} data-testid="profit-empty">
              {alarm ? t("Строк в минус и с низкой маржой нет", "Zarar va past marjali qatorlar yo'q") : t("За этот период продаж нет", "Bu davrda sotuv yo'q")}
            </div>
          ) : (
            <section style={{ background: COLORS.surface, borderRadius: 24, boxShadow: "var(--shadow-raised)", overflow: "hidden" }}>
              <p style={{ fontSize: 12, color: COLORS.textTertiary, margin: 0, padding: "14px 20px 4px" }}>
                {t(`Красным — валовая прибыль в минус; жёлтым — заметная доля выручки (от ${MARGIN_RULES.NOTABLE_REVENUE_SHARE_PCT}%) при марже ниже ${MARGIN_RULES.LOW_MARGIN_PCT}%.`,
                   `Qizil — yalpi foyda zararda; sariq — tushumda sezilarli ulush (${MARGIN_RULES.NOTABLE_REVENUE_SHARE_PCT}% dan) va marja ${MARGIN_RULES.LOW_MARGIN_PCT}% dan past.`)}
              </p>
              <CardTable style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }} data-testid="profit-table">
                  <thead><tr>
                    {sortHead("name", nameHead)}
                    {sortHead("revenue", t("ВЫРУЧКА", "TUSHUM"), "right")}
                    {sortHead("cost", t("СЕБЕСТОИМОСТЬ", "TANNARX"), "right")}
                    {sortHead("profit", t("ПРИБЫЛЬ", "FOYDA"), "right")}
                    {sortHead("margin", t("МАРЖА", "MARJA"), "right")}
                    {sortHead("share", t("ДОЛЯ В ПРИБЫЛИ", "FOYDADAGI ULUSH"), "right")}
                    <th style={thStyle}>{t("ПОЧЕМУ", "NEGA")}</th>
                  </tr></thead>
                  <tbody>
                    {rows.slice(0, shown).map(x => {
                      const tone = x.flag ? FLAG_TEXT[x.flag] : COLORS.textPrimary;
                      const cell = { ...tdStyle, fontVariantNumeric: "tabular-nums" as const, textAlign: "right" as const, whiteSpace: "nowrap" as const };
                      return (
                        <tr key={`${x.key ?? "none"}`} data-testid="profit-row" data-flag={x.flag ?? ""} style={x.flag ? { background: FLAG_BG[x.flag] } : undefined}>
                          <td style={{ ...tdStyle, minWidth: phone ? undefined : 200 }}>
                            <span>
                              <span style={{ fontWeight: 600 }}>{x.name}</span>
                              {(x.sub || x.flag) && (
                                <span style={{ display: "block", fontSize: 12, marginTop: 2 }}>
                                  {x.sub && <span style={{ color: COLORS.textTertiary }}>{x.sub}</span>}
                                  {x.sub && x.flag && <span style={{ color: COLORS.textTertiary }}> · </span>}
                                  {x.flag && (
                                    <span style={{ fontWeight: 700, color: tone, whiteSpace: "nowrap" }}>
                                      {x.flag === "loss" ? t("в минус", "zararda") : t("низкая маржа", "past marja")}
                                    </span>
                                  )}
                                </span>
                              )}
                            </span>
                          </td>
                          <td style={cell}>{fmt(x.revenue)}</td>
                          <td style={{ ...cell, color: COLORS.textSecondary }}>{fmt(x.cost)}</td>
                          <td style={{ ...cell, fontWeight: 700, color: x.profit < 0 ? "var(--color-danger-text)" : COLORS.textPrimary }}>{fmt(x.profit)}</td>
                          <td style={{ ...cell, fontWeight: 700, color: tone }}>{pctText(x.marginPct)}</td>
                          <td style={{ ...cell, color: COLORS.textSecondary }}>{pctText(x.profitShare)}</td>
                          <td style={{ ...tdStyle, color: COLORS.textSecondary, fontSize: 12, minWidth: phone ? undefined : 220 }}>
                            {x.reasons.length === 0 ? (
                              // Тревога без причин в данных — тоже ответ: скидок, ступеней и
                              // возвратов нет, маржу съела закупочная цена.
                              x.flag ? <span>{t("Скидок, ступеней и возвратов нет — дело в цене закупки", "Chegirma, pog'ona va qaytarish yo'q — gap xarid narxida")}</span> : "—"
                            ) : (
                              <span className="flex flex-col gap-0.5">
                                {x.reasons.map(z => <span key={z.code} data-testid="profit-reason">{marginReasonText(z, lang, money)}</span>)}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardTable>
              {rows.length > shown && (
                <div style={{ padding: 16 }}>
                  <button type="button" onClick={() => setShown(n => n + 30)} className="neo-btn tap w-full" style={{ minHeight: 44 }}>
                    {t(`Показать ещё ${Math.min(30, rows.length - shown)} (осталось ${rows.length - shown})`,
                       `Yana ${Math.min(30, rows.length - shown)} ko'rsatish (qoldi ${rows.length - shown})`)}
                  </button>
                </div>
              )}
            </section>
          )}
          <p style={{ fontFamily: F.body, fontSize: 12, color: COLORS.textTertiary, margin: 0 }}>
            {t("Скидка заказа делится между его строками по их сумме; возвраты вычитаются в месяце проведения — как в P&L.",
               "Buyurtma chegirmasi qatorlarga summasiga ko'ra bo'linadi; qaytarishlar o'tkazilgan oyda ayiriladi — P&L dagidek.")}
          </p>
        </>
      )}
    </div>
  );
}
