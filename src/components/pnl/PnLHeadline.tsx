import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { ProgressRing } from "@/components/ProgressRing";
import { colorMix } from "@/lib/color-mix";
import { F, COLORS, profitInk } from "./styles";

interface Totals {
  revenue?: number;
  cogs?: number;
  operatingExpenses?: number;
  grossProfit?: number;
  netProfit?: number;
  grossMarginPct?: number;
  netMarginPct?: number;
  orderCount?: number;
}

interface PnLHeadlineProps {
  current: Totals | undefined;
  previous: Totals | null | undefined;
  deltas:
    | {
        netProfit?: number | null;
        grossMarginPct?: number | null;
        netMarginPct?: number | null;
      }
    | undefined;
  /** Период, с которым сравнивают. Сервер его отдаёт — на экране его не было. */
  prevPeriod: { from: string; to: string } | null | undefined;
  fmt: (value: number) => string;
  t: (ru: string, uz: string) => string;
  lang: string;
}

/** Кольцо-показатель: доля, у которой есть смысловые пороги. */
function MarginMeter({
  pct,
  label,
  delta,
  t,
}: {
  pct: number;
  label: string;
  delta?: number | null;
  t: (ru: string, uz: string) => string;
}) {
  // Маржа — состояние дела, а не оформление: пороги те же, что у значков в
  // таблицах ниже, чтобы «зелёное» на всей странице означало одно и то же.
  const ink =
    pct >= 20 ? "var(--color-success)" : pct >= 10 ? "var(--color-warning)" : "var(--color-danger)";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
      <ProgressRing
        value={Math.max(0, Math.min(100, pct))}
        color={ink}
        trackColor={colorMix(ink, 14)}
        size={72}
        strokeWidth={6}
        label={`${pct.toFixed(0)}%`}
      />
      <div>
        <div className="kpi-hero-label">{label}</div>
        <p
          style={{
            margin: "4px 0 0",
            fontSize: "11px",
            fontWeight: 600,
            fontFamily: F.body,
            fontVariantNumeric: "tabular-nums",
            color:
              delta == null
                ? COLORS.textTertiary
                : delta >= 0
                  ? "var(--color-success-text)"
                  : "var(--color-danger-text)",
          }}
        >
          {delta == null
            ? t("не с чем сравнить", "taqqoslash yo'q")
            : `${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)} ${t("п.п.", "f.p.")}`}
        </p>
      </div>
    </div>
  );
}

/**
 * Полоса «куда ушла выручка».
 *
 * Числа отвечают «сколько», но не «на что ушло». Состав считался из пяти
 * карточек в уме: выручка минус себестоимость минус доставка. Полоса
 * показывает то же за один взгляд, а подписи под ней несут суммы и доли —
 * внутрь сегментов текст не ставится: узкий сегмент обрежет его на середине
 * слова, и это хуже, чем подпись рядом.
 */
function CompositionBar({
  revenue,
  cogs,
  expenses,
  profit,
  fmt,
  t,
}: {
  revenue: number;
  cogs: number;
  expenses: number;
  profit: number;
  fmt: (value: number) => string;
  t: (ru: string, uz: string) => string;
}) {
  // При убытке расходы БОЛЬШЕ выручки, и делить их на выручку нельзя: сумма
  // долей перевалит за сто процентов и полоса уедет за карточку. Тогда за
  // основу берётся весь отток, а место, где кончилась выручка, отмечается
  // засечкой — видно ровно то, что произошло: денег ушло больше, чем пришло.
  const outflow = cogs + expenses;
  const base = profit >= 0 ? revenue : outflow;
  if (base <= 0) return null;

  const costTone = "var(--kpi-orange)";
  const segments = [
    { key: "cogs", label: t("Себестоимость", "Tannarx"), value: cogs, color: costTone },
    {
      key: "expenses",
      label: t("Доставка", "Yetkazish"),
      value: expenses,
      // Тот же оттенок, но светлее: обе строки — деньги наружу, и родство
      // должно читаться. Отдельный цвет здесь сказал бы, что это разные по
      // природе вещи.
      color: colorMix(costTone, 55),
    },
  ];
  if (profit >= 0) {
    segments.push({
      key: "profit",
      label: t("Осталось", "Qoldi"),
      value: profit,
      color: "var(--color-success)",
    });
  }

  const revenueMark = profit < 0 ? (revenue / base) * 100 : null;

  return (
    <div>
      <div
        style={{
          position: "relative",
          display: "flex",
          gap: "2px",
          height: "16px",
          borderRadius: "8px",
          overflow: "hidden",
          background: COLORS.surfaceLight,
        }}
      >
        {segments
          .filter((s) => s.value > 0)
          .map((s) => (
            <div
              key={s.key}
              style={{ width: `${(s.value / base) * 100}%`, background: s.color }}
            />
          ))}
        {revenueMark !== null && (
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${revenueMark}%`,
              width: "2px",
              background: COLORS.textPrimary,
            }}
            title={t("Здесь кончилась выручка", "Tushum shu yerda tugadi")}
          />
        )}
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "8px 20px",
          marginTop: "12px",
        }}
      >
        {segments.map((s) => (
          <div key={s.key} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                width: "10px",
                height: "10px",
                borderRadius: "3px",
                background: s.color,
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: "12px", color: COLORS.textSecondary, fontFamily: F.body }}>
              {s.label}
            </span>
            <span
              style={{
                fontSize: "12px",
                fontWeight: 600,
                fontFamily: F.display,
                fontVariantNumeric: "tabular-nums",
                color: COLORS.textPrimary,
              }}
            >
              {fmt(s.value)}
            </span>
            <span
              style={{
                fontSize: "11px",
                fontFamily: F.body,
                fontVariantNumeric: "tabular-nums",
                color: COLORS.textTertiary,
              }}
            >
              {revenue > 0 ? `${((s.value / revenue) * 100).toFixed(0)}%` : "—"}
            </span>
          </div>
        ))}
        {profit < 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                width: "2px",
                height: "12px",
                background: COLORS.textPrimary,
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: "12px", color: COLORS.textSecondary, fontFamily: F.body }}>
              {t("Выручка кончилась здесь", "Tushum shu yerda tugadi")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function PnLHeadline({
  current,
  previous,
  deltas,
  prevPeriod,
  fmt,
  t,
  lang,
}: PnLHeadlineProps) {
  const revenue = current?.revenue ?? 0;
  const cogs = current?.cogs ?? 0;
  const expenses = current?.operatingExpenses ?? 0;
  const net = current?.netProfit ?? 0;
  const delta = deltas?.netProfit ?? null;
  const noSales = (current?.orderCount ?? 0) === 0;

  const grew = delta !== null && delta > 0;
  const fell = delta !== null && delta < 0;

  const period = (p: { from: string; to: string }) =>
    `${p.from.split("-").reverse().join(".")} — ${p.to.split("-").reverse().join(".")}`;

  return (
    <div className="neo-card neo-card-static" style={{ padding: "24px" }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "24px",
        }}
      >
        <div style={{ minWidth: "240px" }}>
          <div className="kpi-hero-label">
            {net >= 0 ? t("ЗАРАБОТАЛИ ЗА ПЕРИОД", "DAVR UCHUN FOYDA") : t("ПОТЕРЯЛИ ЗА ПЕРИОД", "DAVR UCHUN ZARAR")}
          </div>
          {/* Единственное крупное число на странице. Пропорциональные цифры,
              а не табличные: у «121» табличными расходятся просветы, и на
              48 пикселях это видно. */}
          <div
            style={{
              fontFamily: F.display,
              fontSize: "clamp(34px, 4vw, 48px)",
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: "-0.035em",
              color: profitInk(net),
              marginTop: "6px",
            }}
          >
            {fmt(net)}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "6px",
              marginTop: "10px",
              fontSize: "13px",
              fontFamily: F.body,
            }}
          >
            {delta === null ? (
              <span style={{ color: COLORS.textTertiary }}>
                {t("Не с чем сравнивать: за прошлый период данных нет", "Oldingi davr ma'lumoti yo'q")}
              </span>
            ) : (
              <>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "3px",
                    fontWeight: 700,
                    fontVariantNumeric: "tabular-nums",
                    color: grew
                      ? "var(--color-success-text)"
                      : fell
                        ? "var(--color-danger-text)"
                        : COLORS.textTertiary,
                  }}
                >
                  {grew ? <ArrowUpRight size={15} /> : fell ? <ArrowDownRight size={15} /> : <Minus size={15} />}
                  {grew ? "+" : fell ? "−" : ""}
                  {Math.abs(delta).toFixed(1)}%
                </span>
                <span style={{ color: COLORS.textSecondary }}>
                  {t("к прошлому периоду", "oldingi davrga")}
                  {previous ? `, ${t("было", "edi")} ${fmt(previous.netProfit ?? 0)}` : ""}
                </span>
              </>
            )}
          </div>
          {/* С чем именно сравнивают, страница не говорила вовсе: «+12%» — к
              чему? Сервер отдаёт границы прошлого периода, показываем их. */}
          {prevPeriod && (
            <div style={{ marginTop: "4px", fontSize: "11px", color: COLORS.textTertiary }}>
              {t("Прошлый период", "Oldingi davr")}: {period(prevPeriod)}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "24px" }}>
          <MarginMeter
            pct={current?.grossMarginPct ?? 0}
            label={lang === "uz" ? "YALPI MARJA" : "ВАЛОВАЯ МАРЖА"}
            delta={deltas?.grossMarginPct}
            t={t}
          />
          <MarginMeter
            pct={current?.netMarginPct ?? 0}
            label={lang === "uz" ? "TOZA MARJA" : "ЧИСТАЯ МАРЖА"}
            delta={deltas?.netMarginPct}
            t={t}
          />
        </div>
      </div>

      <div
        style={{
          marginTop: "24px",
          paddingTop: "20px",
          borderTop: `1px solid ${COLORS.border}`,
        }}
      >
        {noSales && revenue === 0 ? (
          <p style={{ margin: 0, fontSize: "13px", color: COLORS.textSecondary, fontFamily: F.body }}>
            {expenses > 0
              ? t(
                  "Продаж за период не было — в минусе только расходы на доставку.",
                  "Davr ichida sotuv bo'lmagan — faqat yetkazish xarajatlari."
                )
              : t(
                  "За выбранный период продаж и расходов не было.",
                  "Tanlangan davrda sotuv ham, xarajat ham bo'lmagan."
                )}
          </p>
        ) : (
          <CompositionBar
            revenue={revenue}
            cogs={cogs}
            expenses={expenses}
            profit={net}
            fmt={fmt}
            t={t}
          />
        )}
      </div>
    </div>
  );
}
