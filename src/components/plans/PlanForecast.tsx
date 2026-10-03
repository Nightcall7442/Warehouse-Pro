import { useState } from "react";
import { useNavigate } from "react-router";
import { ArrowRight, CalendarClock, Target } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { useIsMobile } from "@/hooks/use-mobile";
import { CardTable } from "@/components/CardTable";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import { F, COLORS, thStyle, tdStyle } from "@/components/users/types";
import { monthLabel } from "@/components/plans/month";
import {
  FORECAST_RULES, FORECAST_TONE_COLOR, forecastToneLabel, needPerDayText,
  type ForecastLine, type ForecastTone, type WorkDays,
} from "@contracts/plan-forecast";

/*
  Прогноз выполнения месячного плана — три места, одна ручка
  (salesTarget.forecast) и одна формула (contracts/plan-forecast.ts):

    • главная директора — компактно: компания и «Кто не дотягивает»;
    • «Отчёты» → «Агенты» и «Планы» → «Нормы» — полностью, по каждому;
    • KPI — столбцом прогноза в таблице агентов (ForecastCell).

  Первые FORECAST_RULES.EARLY_WORKDAYS рабочих дня — без цвета и с подписью
  «рано судить»: темп двух дней, умноженный на двадцать шесть, — гадание.
*/

type Fmt = (n: number) => string;
const pctText = (v: number | null) => (v == null ? "—" : `${v}%`);

/** Прогноз одной строкой: «41,2 млн · 96%» цветом тона, «рано судить» — серым. */
export function ForecastCell({ line, lang, fmt }: { line: ForecastLine; lang: string; fmt: Fmt }) {
  const color = FORECAST_TONE_COLOR[line.tone];
  return (
    <span className="inline-flex flex-col items-end" data-testid="forecast-cell" data-tone={line.tone}>
      <span className="font-data" style={{ fontWeight: 700, color: line.tone === "none" || line.tone === "early" ? COLORS.textPrimary : color, whiteSpace: "nowrap" }}>
        {fmt(line.forecast)}{line.forecastPct != null && ` · ${pctText(line.forecastPct)}`}
      </span>
      {(line.tone === "early" || line.tone === "none") && (
        <span style={{ fontSize: 11, color }}>{forecastToneLabel(line.tone, lang)}</span>
      )}
    </span>
  );
}

function daysText(d: WorkDays, lang: string): string {
  return lang === "uz"
    ? `ish kuni ${d.passed} / ${d.total}, qoldi ${d.left}`
    : `рабочий день ${d.passed} из ${d.total}, осталось ${d.left}`;
}


/** Полоса «факт → прогноз» относительно плана. */
function PlanBar({ line }: { line: ForecastLine }) {
  if (line.plan == null) return null;
  const fact = Math.min(100, (line.fact / line.plan) * 100);
  const fc = Math.min(100, (line.forecast / line.plan) * 100);
  const color = line.tone === "early" ? "var(--color-primary)" : FORECAST_TONE_COLOR[line.tone];
  return (
    <div aria-hidden style={{ position: "relative", height: 8, borderRadius: 999, background: "var(--color-surface-light)", boxShadow: "var(--shadow-pressed)", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, width: `${fc}%`, background: `color-mix(in srgb, ${color} 28%, transparent)` }} />
      <div style={{ position: "absolute", inset: 0, width: `${fact}%`, background: color, borderRadius: 999 }} />
    </div>
  );
}

function CompanyLine({ line, days, early, lang, fmt }: { line: ForecastLine; days: WorkDays; early: boolean; lang: string; fmt: Fmt }) {
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const color = FORECAST_TONE_COLOR[line.tone];
  return (
    <div data-testid="forecast-company" data-tone={line.tone}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-data" style={{ fontFamily: F.display, fontSize: 26, fontWeight: 800, color: line.tone === "early" || line.tone === "none" ? COLORS.textPrimary : color, letterSpacing: "-0.03em" }}>
          {line.forecastPct != null ? `${line.forecastPct}%` : fmt(line.forecast)}
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color }}>
          {forecastToneLabel(line.tone, lang)}
        </span>
      </div>
      <div style={{ margin: "10px 0 8px" }}><PlanBar line={line} /></div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1" style={{ fontSize: 12, color: COLORS.textSecondary }}>
        <span>{t("Факт", "Fakt")}: <b className="font-data" style={{ color: COLORS.textPrimary }}>{fmt(line.fact)}</b></span>
        <span>{t("План", "Reja")}: <b className="font-data" style={{ color: COLORS.textPrimary }}>{line.plan != null ? fmt(line.plan) : "—"}</b></span>
        <span>{t("Прогноз", "Prognoz")}: <b className="font-data" style={{ color: COLORS.textPrimary }}>{fmt(line.forecast)}</b></span>
        <span>{t("Нужно", "Kerak")}: <b className="font-data" style={{ color: COLORS.textPrimary }}>{needPerDayText(line, lang, fmt)}</b></span>
      </div>
      <p style={{ fontSize: 11, color: COLORS.textTertiary, margin: "8px 0 0" }}>
        {daysText(days, lang)}
        {early && t(` · первые ${FORECAST_RULES.EARLY_WORKDAYS} рабочих дня — рано судить`, ` · birinchi ${FORECAST_RULES.EARLY_WORKDAYS} ish kuni — hukm qilishga erta`)}
      </p>
    </div>
  );
}

/** Главная директора: компания и «Кто не дотягивает». */
export function PlanForecastCompact({ to = "/reports?tab=agents" }: { to?: string }) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { fmt } = useCurrency();
  const navigate = useNavigate();
  const q = trpc.salesTarget.forecast.useQuery(undefined, { retry: false });
  const f = q.data;
  if (q.isError || !f) return null;
  if (f.company.plan == null && f.agents.every(a => a.plan == null)) return null;
  const lagging = f.agents.filter(a => a.tone === "red" || a.tone === "yellow").slice(0, 5);
  const money = (n: number) => fmt(n, true);
  return (
    <section className="neo-card" style={{ padding: 20 }} data-testid="forecast-compact">
      <div className="flex items-center justify-between gap-3" style={{ marginBottom: 12 }}>
        <h3 className="flex items-center gap-2" style={{ fontFamily: F.display, fontSize: 15, fontWeight: 700, color: COLORS.textPrimary, margin: 0 }}>
          <Target size={16} color="var(--color-primary-text)" aria-hidden />
          {t("Прогноз плана", "Reja prognozi")} · {monthLabel(f.month, lang).toLowerCase()}
        </h3>
        <button type="button" onClick={() => navigate(to)} className="neo-btn tap" style={{ minHeight: 44, padding: "0 12px", gap: 6 }} aria-label={t("Все агенты", "Barcha agentlar")}>
          <ArrowRight size={15} aria-hidden />
        </button>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-4">
      <CompanyLine line={f.company} days={f.days} early={f.early} lang={lang} fmt={money} />
      {f.early && (
        <p data-testid="forecast-early-note" style={{ fontSize: 13, color: COLORS.textSecondary, margin: 0, alignSelf: "center", lineHeight: 1.5 }}>
          {t(`Первые ${FORECAST_RULES.EARLY_WORKDAYS} рабочих дня месяца темп — это один-два дня продаж, умноженные на все рабочие дни. Кто не дотягивает — покажем с ${FORECAST_RULES.EARLY_WORKDAYS + 1}-го рабочего дня.`,
             `Oyning birinchi ${FORECAST_RULES.EARLY_WORKDAYS} ish kunida sur'at — bir-ikki kunlik savdo, barcha ish kunlariga ko'paytirilgan. Kim yetishmayotganini ${FORECAST_RULES.EARLY_WORKDAYS + 1}-ish kunidan ko'rsatamiz.`)}
        </p>
      )}
      {!f.early && (
        <div data-testid="forecast-lagging">
          <p className="font-label" style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: COLORS.textTertiary, margin: "0 0 4px" }}>
            {t("Кто не дотягивает", "Kim yetishmayapti")}
          </p>
          {lagging.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--color-success-text)", margin: 0 }}>{t("Все с планом идут на выполнение", "Rejali hammasi bajarish yo'lida")}</p>
          ) : lagging.map(a => (
            <div key={a.userId} className="flex items-center justify-between gap-3" style={{ padding: "7px 0", fontSize: 13 }} data-testid="forecast-lagging-row">
              <span className="min-w-0 truncate" style={{ color: COLORS.textPrimary, fontWeight: 600 }}>{a.name}</span>
              <span className="font-data flex-shrink-0" style={{ color: FORECAST_TONE_COLOR[a.tone], fontWeight: 700 }}>
                {pctText(a.forecastPct)} <span style={{ color: COLORS.textTertiary, fontWeight: 500 }}>· {t("нужно", "kerak")} {needPerDayText(a, lang, money)}</span>
              </span>
            </div>
          ))}
        </div>
      )}
      </div>
    </section>
  );
}

const TONE_FILTERS: ReadonlyArray<ForecastTone | "all"> = ["all", "red", "yellow", "green"];

/** Полностью: компания и каждый агент — «Отчёты» → «Агенты», «Планы» → «Нормы». */
export function PlanForecastCard() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { fmt } = useCurrency();
  const phone = useIsMobile();
  const q = trpc.salesTarget.forecast.useQuery(undefined, { retry: false });
  const [tone, setTone] = useState<ForecastTone | "all">("all");
  if (q.isError) return <QueryErrorFallback onRetry={() => void q.refetch()} />;
  const f = q.data;
  if (!f) return <div className="rounded-3xl animate-pulse" style={{ height: 180, background: "var(--color-surface-light)" }} />;
  const rows = tone === "all" ? f.agents : f.agents.filter(a => a.tone === tone);
  const cell = { ...tdStyle, fontVariantNumeric: "tabular-nums" as const, textAlign: "right" as const, whiteSpace: "nowrap" as const };
  return (
    <section style={{ background: COLORS.surface, borderRadius: 24, boxShadow: "var(--shadow-raised)", overflow: "hidden" }} data-testid="forecast-card">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-5" style={{ padding: 20 }}>
        <div>
          <h3 className="flex items-center gap-2" style={{ fontFamily: F.display, fontSize: 15, fontWeight: 700, color: COLORS.textPrimary, margin: "0 0 12px" }}>
            <CalendarClock size={16} color="var(--color-primary-text)" aria-hidden />
            {t("Прогноз плана", "Reja prognozi")} · {monthLabel(f.month, lang).toLowerCase()}
          </h3>
          <CompanyLine line={f.company} days={f.days} early={f.early} lang={lang} fmt={fmt} />
        </div>
        <div style={{ fontSize: 12, color: COLORS.textSecondary, lineHeight: 1.55, alignSelf: "end" }}>
          {t("Прогноз = факт ÷ прошедшие рабочие дни × все рабочие дни месяца (выходной — воскресенье). Факт — выручка по доставленным заказам за вычетом возвратов, как в KPI. Зелёный — от 100% плана, жёлтый — 90–99%, красный — ниже 90%.",
             "Prognoz = fakt ÷ o'tgan ish kunlari × oydagi barcha ish kunlari (dam olish — yakshanba). Fakt — yetkazilgan buyurtmalar tushumi, qaytarishlarsiz, KPI dagidek. Yashil — rejaning 100% dan, sariq — 90–99%, qizil — 90% dan past.")}
        </div>
      </div>
      {f.agents.length > 0 && (
        <>
          {!f.early && (
            <div role="radiogroup" aria-label={t("Цвет прогноза", "Prognoz rangi")} className="range-pills" style={{ margin: "0 20px 8px", flexWrap: "wrap", maxWidth: "calc(100% - 40px)" }}>
              {TONE_FILTERS.map(x => (
                <button key={x} type="button" role="radio" aria-checked={tone === x} onClick={() => setTone(x)}
                  className={"range-pill tap" + (tone === x ? " active" : "")}>
                  {x === "all" ? t("Все", "Barchasi") : forecastToneLabel(x, lang)}
                </button>
              ))}
            </div>
          )}
          <CardTable style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }} data-testid="forecast-table">
              <thead><tr>
                {[t("АГЕНТ", "AGENT"), t("ФАКТ", "FAKT"), t("ПЛАН", "REJA"), t("ПРОГНОЗ", "PROGNOZ"), t("НУЖНО В ДЕНЬ", "KUNIGA KERAK")].map((h, i) => (
                  <th key={h} style={{ ...thStyle, textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {rows.map(a => (
                  <tr key={a.userId} data-testid="forecast-row" data-tone={a.tone}>
                    <td style={tdStyle}>
                      <span>
                        <span style={{ fontWeight: 600 }}>{a.name}</span>
                        {a.planStart && a.planStart.slice(0, 7) !== f.month && (
                          <span style={{ display: phone ? "inline" : "block", fontSize: 11, color: COLORS.textTertiary }}>
                            {" "}{t(`план с ${a.planStart.split("-").reverse().join(".")}`, `reja ${a.planStart.split("-").reverse().join(".")} dan`)}
                          </span>
                        )}
                      </span>
                    </td>
                    <td style={cell}>{fmt(a.fact)}</td>
                    <td style={{ ...cell, color: a.plan == null ? COLORS.textTertiary : COLORS.textSecondary }}>{a.plan != null ? fmt(a.plan) : t("нет плана", "reja yo'q")}</td>
                    <td style={cell}><ForecastCell line={a} lang={lang} fmt={fmt} /></td>
                    <td style={{ ...cell, color: COLORS.textSecondary }}>{needPerDayText(a, lang, fmt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardTable>
        </>
      )}
    </section>
  );
}
