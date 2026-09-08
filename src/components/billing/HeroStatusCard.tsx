import { CheckCircle2, AlertTriangle, CalendarDays, Wallet } from "lucide-react";
import { DaysRing } from "./DaysRing";

interface HeroStatusCardProps {
  daysLeft: number;
  isExpired: boolean;
  trialActive: boolean;
  planName: string;
  /** Цена текущего тарифа в сумах. */
  price: number;
  /** Когда кончается — пробный период или оплаченный срок. */
  endsAt: Date | string | null;
  lang: string;
  t: (ru: string, uz: string) => string;
}

/**
 * Состояние подписки.
 *
 * ── Чего не хватало ─────────────────────────────────────────────────────────
 *
 * Было только «осталось 12 дней». Директор по такой строке не может ничего
 * запланировать: чтобы понять, к какому числу платить, он открывал календарь и
 * считал сам. Дата приходила с сервера всё это время и выбрасывалась.
 *
 * Цена текущего тарифа — оттуда же и тоже не показывалась: сколько человек
 * платит сейчас, на экране оплаты было не написано.
 */
export function HeroStatusCard({
  daysLeft, isExpired, trialActive, planName, price, endsAt, lang, t,
}: HeroStatusCardProps) {
  const date = endsAt ? new Date(endsAt) : null;
  const dateText = date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString(lang === "uz" ? "uz" : "ru", { day: "numeric", month: "long", year: "numeric" })
    : null;

  return (
    <div
      className="neo-card neo-card-static"
      style={{
        position: "relative", overflow: "hidden", padding: "26px",
        background: `linear-gradient(135deg, color-mix(in srgb, ${isExpired ? "var(--color-danger)" : "var(--color-primary)"} 7%, var(--color-surface)) 0%, var(--color-surface) 100%)`,
      }}
    >
      {/* Световое пятно в углу — чтобы карточка не выглядела заливкой. */}
      <div style={{
        position: "absolute", top: "-40px", right: "-40px", width: "170px", height: "170px",
        borderRadius: "50%", filter: "blur(40px)", opacity: 0.07, pointerEvents: "none",
        background: isExpired ? "var(--color-danger)" : "var(--color-primary)",
      }} />

      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: "20px", flexWrap: "wrap" }}>
        <DaysRing daysLeft={daysLeft} danger={isExpired} />

        <div style={{ flex: 1, minWidth: "200px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "5px" }}>
            {isExpired
              ? <AlertTriangle size={17} style={{ color: "var(--color-danger-text, var(--color-danger))" }} />
              : <CheckCircle2 size={17} style={{ color: "var(--color-success-text, var(--color-success))" }} />}
            <span style={{ fontSize: "18px", fontWeight: 700, color: "var(--color-text-primary)", letterSpacing: "-0.01em" }}>
              {planName}
            </span>
          </div>

          <p style={{ fontSize: "13.5px", lineHeight: 1.5, color: "var(--color-text-secondary)" }}>
            {isExpired
              ? t("Подписка истекла — продлите доступ", "Obuna tugadi — kirishni uzaytiring")
              : trialActive
                ? t(`Пробный период, осталось ${daysLeft} дн.`, `Sinov muddati, ${daysLeft} kun qoldi`)
                : t(`Активна ещё ${daysLeft} дн.`, `Yana ${daysLeft} kun faol`)}
          </p>

          {/* Дата и цена — то, по чему планируют платёж. */}
          <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap", marginTop: "12px" }}>
            {dateText && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12.5px", color: "var(--color-text-tertiary)" }}>
                <CalendarDays size={14} />
                {isExpired
                  ? t(`истекла ${dateText}`, `${dateText} tugadi`)
                  : t(`до ${dateText}`, `${dateText} gacha`)}
              </span>
            )}
            {price > 0 && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12.5px", color: "var(--color-text-tertiary)" }}>
                <Wallet size={14} />
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{price.toLocaleString("ru")}</span>
                {t("сум/мес", "so'm/oy")}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
