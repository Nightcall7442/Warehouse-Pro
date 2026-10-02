import { useMemo, useState } from "react";
import { FileDown, Lightbulb, PackageX, Store } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { useCurrency } from "@/hooks/useCurrency";
import { useIsMobile } from "@/hooks/use-mobile";
import { useUrlState, urlEnum } from "@/hooks/useUrlState";
import { exportToExcel } from "@/lib/excel";
import { CardTable } from "@/components/CardTable";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import { F, COLORS, thStyle, tdStyle } from "@/components/users/types";
import { ABC_RULES, type AbcClass, type AbcMetric, type AbcSubject } from "@contracts/margin";
import { lightReasonText } from "@contracts/shop-light";
import { unitShort } from "@/lib/units";
import { PeriodControls, ReportTile, Segmented } from "./ReportPeriod";
import { dmy, useReportPeriod } from "./report-period";

/*
  «ABC» — раздел «Отчётов»: какие товары и магазины дают деньги.

  A — первые 80% денег, B — следующие 15%, C — остальное (границы и что
  бывает ровно на 80% — contracts/margin.ts). Таблица — с накопленной долей,
  чтобы граница класса была видна глазом, а не на слово.

  Ниже плиток — две подсказки, ради которых раздел и открывают: C-товары,
  которые лежат на основном складе (деньги, которые не работают), и
  A-магазины, которые давно не заказывали (самые дорогие потери).

  «По прибыли» — только директору: прибыль строки — та же наценка, что и в
  «Прибыли». Остальным переключателя нет, остаток C-товаров — по цене продажи.
*/

const OF_CODEC = urlEnum<AbcSubject>(["product", "shop"], "product");
const METRIC_CODEC = urlEnum<AbcMetric>(["revenue", "profit"], "revenue");
const CLS_CODEC = urlEnum<"all" | AbcClass>(["all", "A", "B", "C"], "all");

const ABC_TONE: Record<AbcClass, string> = {
  A: "var(--color-success-text)",
  B: "var(--color-warning-text)",
  C: "var(--color-text-tertiary)",
};

const LIGHT_DOT = { red: "var(--color-danger)", yellow: "var(--color-warning)", green: "var(--color-success)" } as const;

const pctText = (v: number) => `${String(v).replace(".", ",")}%`;
const qtyText = (v: number) => String(v).replace(".", ",");

export function AbcTab() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { user } = useAuth();
  const finance = user?.role === "ceo";
  const { fmt } = useCurrency();
  const phone = useIsMobile();
  const period = useReportPeriod();
  const { from, to } = period;
  const [of, setOf] = useUrlState<AbcSubject>("of", "product", OF_CODEC);
  const [metricRaw, setMetric] = useUrlState<AbcMetric>("metric", "revenue", METRIC_CODEC);
  // Чужая ссылка «по прибыли» у офиса открывается по выручке, а не отказом.
  const metric: AbcMetric = finance ? metricRaw : "revenue";
  const [cls, setCls] = useUrlState<"all" | AbcClass>("cls", "all", CLS_CODEC);
  const [shown, setShown] = useState(phone ? 10 : 40);

  const q = trpc.reports.abc.useQuery({ from, to, of, metric });
  const r = q.data;
  const rows = useMemo(() => (r ? (cls === "all" ? r.rows : r.rows.filter(x => x.abc === cls)) : []), [r, cls]);
  const valueHead = metric === "profit" ? t("ПРИБЫЛЬ", "FOYDA") : t("ВЫРУЧКА", "TUSHUM");
  const moneyWord = metric === "profit" ? t("прибыли", "foydaning") : t("выручки", "tushumning");

  const exportXlsx = () => {
    if (!r) return;
    const nameCol = of === "product" ? "Товар" : "Магазин";
    void exportToExcel(rows.map((x, i) => ({
      "№": i + 1,
      "Класс": x.abc,
      [nameCol]: x.name,
      [of === "product" ? "Код" : "Город"]: x.sub ?? "",
      "Выручка": x.revenue,
      ...(metric === "profit" ? { "Прибыль": x.profit ?? 0 } : {}),
      "Доля, %": x.share,
      "Накопленная доля, %": x.cumShare,
      ...(of === "product" ? { "Остаток на основном складе": x.stockQty ?? 0 } : {}),
    })), `abc-${of}-${metric}-${from}_${to}`, "ABC",
    `ABC-анализ ${of === "product" ? "товаров" : "магазинов"} по ${metric === "profit" ? "прибыли" : "выручке"} ${dmy(from)} — ${dmy(to)}`);
  };

  const classTile = (c: AbcClass) => {
    const x = r!.totals[c];
    const bound = c === "A" ? t(`первые ${ABC_RULES.A_SHARE_PCT}%`, `birinchi ${ABC_RULES.A_SHARE_PCT}%`)
      : c === "B" ? t(`следующие ${ABC_RULES.B_SHARE_PCT - ABC_RULES.A_SHARE_PCT}%`, `keyingi ${ABC_RULES.B_SHARE_PCT - ABC_RULES.A_SHARE_PCT}%`)
      : t("остальное", "qolgani");
    if (phone) {
      // Три плитки в столбик — экран прокрутки ради трёх чисел; в ряд — коротко.
      return (
        <div key={c} className="kpi-hero" style={{ borderRadius: 20, padding: "14px 12px", minWidth: 0 }} data-testid={`abc-tile-${c}`}>
          <span className="inline-flex items-center justify-center font-data" style={{ width: 28, height: 28, borderRadius: 8, fontWeight: 800, fontSize: 13, color: ABC_TONE[c], background: `color-mix(in srgb, ${ABC_TONE[c]} 14%, transparent)` }}>{c}</span>
          <div className="font-data" style={{ fontFamily: F.display, fontSize: 24, fontWeight: 700, color: COLORS.textPrimary, marginTop: 8, lineHeight: 1 }}>{x.count}</div>
          <div style={{ fontSize: 11, color: COLORS.textTertiary, marginTop: 6 }}>{pctText(x.share)} {moneyWord}</div>
        </div>
      );
    }
    return (
      <ReportTile key={c} testid={`abc-tile-${c}`}
        label={t(`Класс ${c} · ${bound}`, `${c} sinf · ${bound}`)}
        value={String(x.count)}
        sub={t(`${pctText(x.share)} ${moneyWord} · ${fmt(x.value)}`, `${moneyWord} ${pctText(x.share)} · ${fmt(x.value)}`)}
        icon={<span style={{ fontFamily: F.display, fontWeight: 800, fontSize: 17 }}>{c}</span>} tone={ABC_TONE[c]} />
    );
  };

  return (
    <div className="space-y-4" data-testid="abc-report">
      <div className="neo-card report-filters" style={{ padding: 16 }}>
        <div className="flex flex-wrap items-end gap-3">
          <PeriodControls period={period} t={t} testid="abc" />
          <button type="button" onClick={exportXlsx} disabled={!r || rows.length === 0} className="neo-btn tap disabled:opacity-40" style={{ minHeight: 44, padding: "0 16px", gap: 7, marginLeft: "auto" }}>
            <FileDown size={15} aria-hidden />Excel
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Segmented label={t("Что делим", "Nimani bo'lamiz")} value={of} onChange={v => { setOf(v); setCls("all"); setShown(phone ? 10 : 40); }}
          options={[{ key: "product", label: t("Товары", "Tovarlar") }, { key: "shop", label: t("Магазины", "Do'konlar") }]} />
        {finance && (
          <Segmented label={t("По чему", "Nima bo'yicha")} value={metric} onChange={setMetric}
            options={[{ key: "revenue", label: t("По выручке", "Tushum bo'yicha") }, { key: "profit", label: t("По прибыли", "Foyda bo'yicha") }]} />
        )}
      </div>

      {q.isError ? <QueryErrorFallback onRetry={() => void q.refetch()} /> : !r ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[0, 1, 2].map(i => <div key={i} className="rounded-3xl animate-pulse" style={{ height: 120, background: "var(--color-surface-light)" }} />)}
        </div>
      ) : (
        <>
          <div className={phone ? "grid grid-cols-3 gap-2" : "grid grid-cols-3 gap-3"} data-testid="abc-totals">
            {(["A", "B", "C"] as const).map(classTile)}
          </div>

          {/* ── Что из этого следует ── */}
          {(r.cStock || r.idleA) && (
            <section className="neo-card" style={{ padding: 20 }} data-testid="abc-hints">
              <h3 className="flex items-center gap-2" style={{ fontFamily: F.display, fontSize: 15, fontWeight: 700, color: COLORS.textPrimary, margin: "0 0 12px" }}>
                <Lightbulb size={16} color="var(--color-warning-text)" aria-hidden />{t("Что из этого следует", "Bundan nima kelib chiqadi")}
              </h3>
              {r.cStock && (r.cStock.count === 0 ? (
                <p style={{ fontSize: 13, color: COLORS.textSecondary, margin: 0 }}>{t("C-товаров на основном складе нет", "Asosiy omborda C-tovarlar yo'q")}</p>
              ) : (
                <div data-testid="abc-c-stock">
                  <div className="flex items-start gap-3" style={{ padding: "12px 14px", borderRadius: 16, background: "var(--color-warning-subtle)" }}>
                    <PackageX size={18} color="var(--color-warning-text)" style={{ flexShrink: 0, marginTop: 1 }} aria-hidden />
                    <span style={{ fontSize: 13, color: COLORS.textPrimary }}>
                      {r.cStock.atCost != null
                        ? t(`C-товары, которые лежат на основном складе: ${r.cStock.count} поз. на ${fmt(r.cStock.atCost)} по себестоимости — деньги, которые не работают`,
                            `Asosiy omborda yotgan C-tovarlar: ${r.cStock.count} ta, tannarx bo'yicha ${fmt(r.cStock.atCost)} — ishlamayotgan pul`)
                        : t(`C-товары, которые лежат на основном складе: ${r.cStock.count} поз. на ${fmt(r.cStock.atPrice)} по цене продажи`,
                            `Asosiy omborda yotgan C-tovarlar: ${r.cStock.count} ta, sotuv narxida ${fmt(r.cStock.atPrice)}`)}
                    </span>
                  </div>
                  {r.cStock.top.slice(0, phone ? 5 : 10).map(c => (
                    <div key={c.key} className="flex items-center justify-between gap-3" style={{ padding: "8px 2px", fontSize: 13 }}>
                      <span className="min-w-0 truncate" style={{ color: COLORS.textPrimary, fontWeight: 600 }}>{c.name}</span>
                      <span className="font-data flex-shrink-0" style={{ color: COLORS.textSecondary }}>{qtyText(c.qty)} {unitShort(c.unit, lang)} · {fmt(c.atCost ?? c.atPrice)}</span>
                    </div>
                  ))}
                </div>
              ))}
              {r.idleA && (r.idleA.length === 0 ? (
                <p style={{ fontSize: 13, color: COLORS.textSecondary, margin: 0 }}>
                  {t(`Все A-магазины заказывали за последние ${ABC_RULES.A_SHOP_IDLE_DAYS} дней`, `Barcha A-do'konlar so'nggi ${ABC_RULES.A_SHOP_IDLE_DAYS} kunda buyurtma bergan`)}
                </p>
              ) : (
                <div data-testid="abc-idle-a">
                  <div className="flex items-start gap-3" style={{ padding: "12px 14px", borderRadius: 16, background: "var(--color-danger-subtle)" }}>
                    <Store size={18} color="var(--color-danger-text)" style={{ flexShrink: 0, marginTop: 1 }} aria-hidden />
                    <span style={{ fontSize: 13, color: COLORS.textPrimary }}>
                      {t(`A-магазины, которые не заказывали ${ABC_RULES.A_SHOP_IDLE_DAYS}+ дней: ${r.idleA.length} — самые дорогие потери, ехать в первую очередь`,
                         `${ABC_RULES.A_SHOP_IDLE_DAYS}+ kun buyurtma bermagan A-do'konlar: ${r.idleA.length} — eng qimmat yo'qotish, birinchi navbatda borish kerak`)}
                    </span>
                  </div>
                  {r.idleA.slice(0, phone ? 6 : 12).map(s => (
                    <div key={s.key} className="flex items-start justify-between gap-3" style={{ padding: "8px 2px", fontSize: 13 }} data-testid="abc-idle-shop">
                      <span className="min-w-0 flex items-start gap-2">
                        <span aria-hidden style={{ width: 10, height: 10, borderRadius: 999, background: LIGHT_DOT[s.color], flexShrink: 0, marginTop: 5 }} />
                        <span className="min-w-0">
                          <span style={{ color: COLORS.textPrimary, fontWeight: 600 }}>{s.name}</span>
                          {s.sub && <span style={{ color: COLORS.textTertiary }}> · {s.sub}</span>}
                          {s.reasons.length > 0 && (
                            <span style={{ display: "block", fontSize: 12, color: COLORS.textTertiary }}>{s.reasons.map(x => lightReasonText(x, lang, n => fmt(n))).join(" · ")}</span>
                          )}
                        </span>
                      </span>
                      <span className="font-data flex-shrink-0" style={{ color: "var(--color-danger-text)", fontWeight: 700 }}>{t(`${s.daysSinceOrder} дн.`, `${s.daysSinceOrder} kun`)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </section>
          )}

          <div role="radiogroup" aria-label={t("Класс", "Sinf")} className="range-pills" style={{ alignSelf: "flex-start" }}>
            {(["all", "A", "B", "C"] as const).map(c => (
              <button key={c} type="button" role="radio" aria-checked={cls === c} onClick={() => setCls(c)} data-testid={`abc-cls-${c}`}
                className={"range-pill tap" + (cls === c ? " active" : "")}>
                {c === "all" ? t("Все", "Barchasi") : c}
              </button>
            ))}
          </div>

          {rows.length === 0 ? (
            <div className="neo-card text-center" style={{ padding: 40, color: COLORS.textSecondary, fontSize: 14 }}>
              {t("За этот период продаж нет", "Bu davrda sotuv yo'q")}
            </div>
          ) : (
            <section style={{ background: COLORS.surface, borderRadius: 24, boxShadow: "var(--shadow-raised)", overflow: "hidden" }}>
              <CardTable style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }} data-testid="abc-table">
                  <thead><tr>
                    {[t("КЛАСС", "SINF"), of === "product" ? t("ТОВАР", "TOVAR") : t("МАГАЗИН", "DO'KON"), valueHead, t("ДОЛЯ", "ULUSH"), t("НАКОПЛЕНО", "JAMLANGAN"),
                      ...(of === "product" ? [t("НА СКЛАДЕ", "OMBORDA")] : [])].map((h, i) => (
                      <th key={h} style={{ ...thStyle, textAlign: i >= 2 ? "right" : "left" }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {rows.slice(0, shown).map(x => {
                      const cell = { ...tdStyle, fontVariantNumeric: "tabular-nums" as const, textAlign: "right" as const, whiteSpace: "nowrap" as const };
                      return (
                        <tr key={`${x.key ?? "none"}`} data-testid="abc-row" data-abc={x.abc}>
                          <td style={tdStyle}>
                            <span className="inline-flex items-center justify-center font-data" style={{ width: 28, height: 28, borderRadius: 8, fontWeight: 800, fontSize: 13, color: ABC_TONE[x.abc], background: `color-mix(in srgb, ${ABC_TONE[x.abc]} 14%, transparent)` }}>{x.abc}</span>
                          </td>
                          <td style={tdStyle}>
                            <span><span style={{ fontWeight: 600 }}>{x.name}</span>{x.sub && <span style={{ color: COLORS.textTertiary, fontSize: 12 }}> · {x.sub}</span>}</span>
                          </td>
                          <td style={{ ...cell, fontWeight: 700, color: x.value < 0 ? "var(--color-danger-text)" : COLORS.textPrimary }}>{fmt(x.value)}</td>
                          <td style={{ ...cell, color: COLORS.textSecondary }}>{pctText(x.share)}</td>
                          <td style={cell}>
                            <span className="inline-flex items-center gap-2" style={{ justifyContent: "flex-end" }}>
                              <span aria-hidden style={{ width: 56, height: 6, borderRadius: 999, background: "var(--color-surface-light)", boxShadow: "var(--shadow-pressed)", overflow: "hidden", display: phone ? "none" : "inline-block" }}>
                                <span style={{ display: "block", width: `${Math.min(100, x.cumShare)}%`, height: "100%", background: ABC_TONE[x.abc] }} />
                              </span>
                              {pctText(x.cumShare)}
                            </span>
                          </td>
                          {of === "product" && <td style={{ ...cell, color: COLORS.textSecondary }}>{x.stockQty != null ? qtyText(x.stockQty) : "—"}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardTable>
              {rows.length > shown && (
                <div style={{ padding: 16 }}>
                  <button type="button" onClick={() => setShown(n => n + 40)} className="neo-btn tap w-full" style={{ minHeight: 44 }}>
                    {t(`Показать ещё ${Math.min(40, rows.length - shown)} (осталось ${rows.length - shown})`,
                       `Yana ${Math.min(40, rows.length - shown)} ko'rsatish (qoldi ${rows.length - shown})`)}
                  </button>
                </div>
              )}
            </section>
          )}
          <p style={{ fontSize: 12, color: COLORS.textTertiary, margin: 0 }}>
            {t(`Позиция, на которой накопленная доля доходит до ${ABC_RULES.A_SHARE_PCT}%, — ещё A, следующая — B; так же на ${ABC_RULES.B_SHARE_PCT}%. Убыточные и без продаж — C.`,
               `Jamlangan ulush ${ABC_RULES.A_SHARE_PCT}% ga yetgan pozitsiya — hali A, keyingisi — B; ${ABC_RULES.B_SHARE_PCT}% da ham shunday. Zarardagi va sotuvsizlar — C.`)}
          </p>
        </>
      )}
    </div>
  );
}
