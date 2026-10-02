import { F, COLORS } from "@/components/users/types";
import { useIsMobile } from "@/hooks/use-mobile";
import { useReportPeriod, PRESET_DAYS } from "./report-period";

export function PeriodControls({ period, t, testid }: {
  period: ReturnType<typeof useReportPeriod>;
  t: (ru: string, uz: string) => string;
  testid: string;
}) {
  const phone = useIsMobile();
  const { from, to, today, setFrom, setTo, preset, presetOn } = period;
  return (
    <>
      <div role="group" aria-label={t("Период", "Davr")} className="range-pills">
        {PRESET_DAYS.map(d => (
          <button key={d} type="button" onClick={() => preset(d)} aria-pressed={presetOn(d)}
            className={"range-pill tap" + (presetOn(d) ? " active" : "")}>
            {t(`${d} дн.`, `${d} kun`)}
          </button>
        ))}
      </div>
      {/* На телефоне даты — ровной парой, а не как ляжет перенос строки. */}
      <div className={phone ? "grid grid-cols-2 gap-3 w-full" : "contents"}>
      <label className="flex flex-col gap-1" style={{ flex: "1 1 140px", maxWidth: phone ? undefined : 170, minWidth: 0 }}>
        <span className="font-label text-[10px] text-secondary">{t("С", "Dan")}</span>
        <input type="date" className="neo-input w-full" value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)} data-testid={`${testid}-from`} style={{ minHeight: 44 }} />
      </label>
      <label className="flex flex-col gap-1" style={{ flex: "1 1 140px", maxWidth: phone ? undefined : 170, minWidth: 0 }}>
        <span className="font-label text-[10px] text-secondary">{t("По", "Gacha")}</span>
        <input type="date" className="neo-input w-full" value={to} min={from} max={today} onChange={e => e.target.value && setTo(e.target.value)} data-testid={`${testid}-to`} style={{ minHeight: 44 }} />
      </label>
      </div>
    </>
  );
}

/** Переключатель из адреса: «товары / магазины / агенты», «по выручке / по прибыли». */
export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: ReadonlyArray<{ key: T; label: string }>;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="range-pills" style={{ flexWrap: "wrap", maxWidth: "100%" }}>
      {options.map(o => (
        <button key={o.key} type="button" role="radio" aria-checked={value === o.key} onClick={() => onChange(o.key)}
          className={"range-pill tap" + (value === o.key ? " active" : "")} style={{ whiteSpace: "nowrap" }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Плитка итога — язык «Пользователей» и «Визитов без заказа»: kpi-hero, без обводок. */
export function ReportTile({ label, value, sub, icon, tone, testid }: {
  label: string; value: string; sub?: React.ReactNode; icon: React.ReactNode; tone: string; testid?: string;
}) {
  // На телефоне плитка в полэкрана: число мельче, значок меньше — иначе «сум»
  // уезжал на вторую строку, а значок выпирал за край у длинной подписи.
  const phone = useIsMobile();
  return (
    <div className="kpi-hero" style={{ borderRadius: 24, padding: phone ? 16 : 20, minWidth: 0 }} data-testid={testid}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: phone ? 8 : 12, marginBottom: 12 }}>
        <span style={{ fontFamily: F.display, fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: phone ? "0.02em" : "0.08em", color: COLORS.textTertiary, minWidth: 0 }}>{label}</span>
        <span style={{ width: phone ? 32 : 40, height: phone ? 32 : 40, borderRadius: 12, background: `color-mix(in srgb, ${tone} 16%, transparent)`, color: tone, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</span>
      </div>
      <div className="font-data" style={{ fontFamily: F.display, fontSize: phone ? 20 : 26, fontWeight: 700, color: COLORS.textPrimary, lineHeight: 1.1, letterSpacing: "-0.03em" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: COLORS.textTertiary, marginTop: 8 }}>{sub}</div>}
    </div>
  );
}
