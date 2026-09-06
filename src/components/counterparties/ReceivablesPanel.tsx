import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import { COLORS } from "./constants";

/**
 * Вторая сторона расчётов: сколько должны НАМ и как давно.
 *
 * ── Чего не хватало ─────────────────────────────────────────────────────────
 *
 * Раздел назывался «Контрагенты и долги», а показывал только одну сторону —
 * наш долг перед заводом. Сколько должны нам, лежало в другом разделе
 * («Магазины») одним числом, и свести обе стороны человек мог только в уме.
 *
 * Хуже того, у чужого долга не было возраста. «Двенадцать миллионов» — это
 * может быть неделя нормальной отсрочки, а может быть полгода денег, которых
 * уже нет. Наш собственный долг перед поставщиком система при этом считала
 * подробно, со сроками и просрочкой.
 *
 * ── Почему строка «не привязано к заказу» показана отдельно ─────────────────
 *
 * Долг магазина складывается не только из заказов: бывают начисления и оплаты,
 * записанные прямо на магазин, и возвраты. У них нет своей даты обязательства,
 * состарить их нельзя. Промолчать об этом означало бы показать корзины,
 * которые не дают итог, — а отчёт, части которого не сходятся, хуже
 * отсутствующего. Поэтому разница названа своим именем и стоит в том же ряду.
 */

const BUCKETS = [
  { key: "d0_7" as const,     ru: "до 7 дней",    uz: "7 kungacha",     tone: "ok" },
  { key: "d8_30" as const,    ru: "8–30 дней",    uz: "8–30 kun",       tone: "ok" },
  { key: "d31_60" as const,   ru: "31–60 дней",   uz: "31–60 kun",      tone: "warn" },
  { key: "d60plus" as const,  ru: "больше 60",    uz: "60 kundan ko'p", tone: "bad" },
];

const toneColor = (tone: string) =>
  tone === "bad" ? "var(--color-danger-text)"
  : tone === "warn" ? "var(--color-warning-text)"
  : "var(--color-text-primary)";

export function ReceivablesPanel() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { fmt } = useCurrency();

  const { data, isLoading, isLoadingError, refetch } = trpc.shop.receivablesAging.useQuery();

  if (isLoadingError) return <QueryErrorFallback onRetry={refetch} />;
  if (isLoading || !data) {
    return <div className="h-40 rounded-2xl animate-pulse" style={{ background: "var(--color-surface-light)" }} />;
  }

  if (data.totalDebt === 0 && data.shops.length === 0) {
    return (
      <div className="neo-card-sm text-center" style={{ padding: "28px" }}>
        <p style={{ color: COLORS.textPrimary, fontWeight: 600, margin: 0 }}>
          {t("Магазины ничего не должны", "Do'konlar qarzdor emas")}
        </p>
        <p style={{ color: COLORS.textTertiary, fontSize: "13px", margin: "6px 0 0" }}>
          {t("Долг появляется, когда заказ отгружен в долг или доставлен без полной оплаты.",
             "Qarz buyurtma qarzga jo'natilganda yoki to'liq to'lovsiz yetkazilganda paydo bo'ladi.")}
        </p>
      </div>
    );
  }

  const bucketRows = BUCKETS.map(b => ({ ...b, amount: data.buckets[b.key] }));
  const worst = data.buckets.d31_60 + data.buckets.d60plus;

  return (
    <div className="neo-card-sm" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "12px", flexWrap: "wrap" }}>
        <div>
          <div className="font-label text-[10px] tracking-wider uppercase" style={{ color: COLORS.textTertiary }}>
            {t("Должны нам", "Bizga qarzdor")}
          </div>
          <div style={{ fontSize: "24px", fontWeight: 700, color: COLORS.textPrimary, fontVariantNumeric: "tabular-nums" }}>
            {fmt(data.totalDebt)}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="font-label text-[10px] tracking-wider uppercase" style={{ color: COLORS.textTertiary }}>
            {t("Должников", "Qarzdorlar")}
          </div>
          <div style={{ fontSize: "17px", fontWeight: 600, color: COLORS.textPrimary, fontVariantNumeric: "tabular-nums" }}>
            {data.debtorCount}
          </div>
        </div>
      </div>

      {/*
        Полоса возраста: доля старого долга видна раньше, чем прочитаны числа.
        Именно она и есть ответ на вопрос «деньги в обороте или уже нет».
      */}
      {data.totalDebt > 0 && (
        <div style={{ display: "flex", height: "8px", borderRadius: "999px", overflow: "hidden", background: "var(--color-surface-light)" }}>
          {bucketRows.filter(b => b.amount > 0).map(b => (
            <div
              key={b.key}
              title={`${t(b.ru, b.uz)}: ${fmt(b.amount)}`}
              style={{
                width: `${(b.amount / data.totalDebt) * 100}%`,
                background: b.tone === "bad" ? "var(--color-danger)"
                  : b.tone === "warn" ? "var(--color-warning)"
                  : "var(--color-primary)",
              }}
            />
          ))}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "10px" }}>
        {bucketRows.map(b => (
          <div key={b.key} style={{ background: "var(--color-surface-light)", borderRadius: "10px", padding: "10px 12px" }}>
            <div style={{ fontSize: "11px", color: COLORS.textTertiary }}>{t(b.ru, b.uz)}</div>
            <div style={{ fontSize: "15px", fontWeight: 600, color: toneColor(b.tone), fontVariantNumeric: "tabular-nums" }}>
              {fmt(b.amount)}
            </div>
          </div>
        ))}
      </div>

      {data.unattributed !== 0 && (
        <p style={{ fontSize: "12px", color: COLORS.textTertiary, margin: 0 }}>
          {t("Не привязано к заказу", "Buyurtmaga bog'lanmagan")}: <b style={{ color: COLORS.textPrimary }}>{fmt(data.unattributed)}</b>
          {" — "}
          {t("ручные начисления, оплаты без заказа и возвраты. Возраст у них не считается.",
             "qo'lda kiritilgan hisoblar, buyurtmasiz to'lovlar va qaytarishlar. Ularning yoshi hisoblanmaydi.")}
        </p>
      )}

      {worst > 0 && (
        <div>
          <div className="font-label text-[10px] tracking-wider uppercase mb-2" style={{ color: COLORS.textTertiary }}>
            {t("Самые старые долги", "Eng eski qarzlar")}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {data.shops
              .filter(s => (s.oldestDays ?? 0) > 30 && s.debt > 0)
              .slice(0, 5)
              .map(s => (
                <div key={s.shopId} style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "baseline" }}>
                  <span style={{ fontSize: "13px", color: COLORS.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.shopName}
                  </span>
                  <span style={{ fontSize: "12px", color: COLORS.textTertiary, whiteSpace: "nowrap" }}>
                    {s.oldestDays} {t("дн.", "kun")} · <b style={{ color: COLORS.textPrimary, fontVariantNumeric: "tabular-nums" }}>{fmt(s.debt)}</b>
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
