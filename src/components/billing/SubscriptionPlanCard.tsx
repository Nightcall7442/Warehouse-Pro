import { Zap, Check, Loader2, LifeBuoy, AlertTriangle } from "lucide-react";
import { FEATURES, PLAN_ADDS, PLAN_ORDER, PLANS, type FeatureKey, type PlanKey } from "@contracts/constants";

export interface Plan {
  key: string;
  name: string;
  nameUz: string;
  price: number;
  maxUsers: number | null;
  maxProducts: number | null;
  maxOrdersMonth: number | null;
}

interface SubscriptionPlanCardProps {
  plan: Plan;
  isCurrent: boolean;
  isPro: boolean;
  /** Сколько у организации СЕЙЧАС — чтобы не предлагать то, что не вместит. */
  usage: { users: number; products: number; orders: number };
  planName: (p: { name: string; nameUz: string }) => string;
  t: (ru: string, uz: string) => string;
  isPending: boolean;
  onSelect: (key: string) => void;
}

/**
 * Карточка тарифа.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Оформление шло мимо системы приложения — через свой словарь designTokens, где
 * имена теней были на ступень мимо настоящих, а свечение вписано числами RGB
 * светлой палитры. Наведение обрабатывалось руками через e.target: при входе
 * курсора на значок внутри кнопки стиль ложился на значок, а не на кнопку. И
 * onMouseLeave присваивал карточке тень, которой onMouseEnter не ставил, —
 * после первого наведения тень менялась НАВСЕГДА.
 *
 * Белый цвет текста кнопки был вписан числом. В тёмной теме акцент золотой, а
 * чернила на нём должны быть тёмными (--color-on-primary) — то есть надпись
 * «Подключить» была белой на золотом.
 *
 * ── Чего не хватало по существу ─────────────────────────────────────────────
 *
 * Тариф мог НЕ ВМЕСТИТЬ нынешнюю нагрузку, и об этом нигде не говорилось:
 * организации с двенадцатью пользователями предлагался Basic на пять. Человек
 * узнавал бы об этом после оплаты.
 *
 * И то единственное, чем Exclusive отличается не числом, — прямая линия с
 * поддержкой — на карточке не упоминалось вовсе.
 */
export function SubscriptionPlanCard({
  plan, isCurrent, isPro, usage, planName, t, isPending, onSelect,
}: SubscriptionPlanCardProps) {
  const limits: Array<{ max: number | null; used: number; label: string; short: string }> = [
    { max: plan.maxUsers, used: usage.users, label: t("пользователей", "foydalanuvchi"), short: t("Пользователи", "Foydalanuvchilar") },
    { max: plan.maxProducts, used: usage.products, label: t("SKU товаров", "SKU mahsulot"), short: t("Товары", "Mahsulotlar") },
    { max: plan.maxOrdersMonth, used: usage.orders, label: t("заказов/мес", "buyurtma/oy"), short: t("Заказы", "Buyurtmalar") },
  ];

  // Что уже не помещается. Считается здесь, а не в голове у покупателя.
  const tooSmall = limits.filter(l => l.max !== null && l.used > l.max);

  /*
    Возможности — из общего каталога, тем же списком, что и на лендинге.
    Раньше на экране оплаты их не было вовсе: тарифы сравнивались по трём
    числам, и чем Pro отличается от Basic по существу, человек при оплате не
    видел.

    Показывается то, что тариф ДОБАВЛЯЕТ, плюс строка «Всё из ...». Полный
    список у Exclusive был бы в тринадцать строк, из которых новых пять, и
    разница между тарифами утонула бы.
  */
  const key = plan.key as PlanKey;
  const adds: readonly FeatureKey[] = PLAN_ADDS[key] ?? [];
  const below = PLAN_ORDER[PLAN_ORDER.indexOf(key) - 1];
  const inherits = below && below !== "trial" ? PLANS[below].name : null;

  return (
    <div
      className={isCurrent ? "neo-card neo-card-static" : "neo-card"}
      style={{
        position: "relative", padding: "22px", display: "flex", flexDirection: "column", gap: "14px",
        overflow: "visible",
        ...(isCurrent ? { boxShadow: "var(--shadow-raised), 0 0 0 2px color-mix(in srgb, var(--color-primary) 30%, transparent)" } : {}),
      }}
    >
      {isPro && !isCurrent && (
        <div style={{
          position: "absolute", top: "-11px", left: "50%", transform: "translateX(-50%)",
          display: "inline-flex", alignItems: "center", gap: "4px",
          padding: "4px 12px", borderRadius: "999px", whiteSpace: "nowrap",
          fontSize: "10px", fontWeight: 700, letterSpacing: "0.04em",
          background: "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))",
          color: "var(--color-on-primary)",
          boxShadow: "0 2px 8px color-mix(in srgb, var(--color-primary) 30%, transparent)",
        }}>
          <Zap size={11} />
          {t("ПОПУЛЯРНЫЙ", "OMMABOP")}
        </div>
      )}

      {/* Имя и цена */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {isPro && <Zap size={15} style={{ color: "var(--color-primary-text)" }} />}
          <p style={{ fontSize: "16px", fontWeight: 700, color: "var(--color-text-primary)" }}>{planName(plan)}</p>
          {isCurrent && (
            <span style={{
              marginLeft: "auto", padding: "3px 9px", borderRadius: "999px",
              fontSize: "10px", fontWeight: 700, letterSpacing: "0.04em",
              color: "var(--color-primary-text)", background: "var(--color-primary-subtle)",
            }}>
              {t("ТЕКУЩИЙ", "JORIY")}
            </span>
          )}
        </div>
        <p style={{ fontSize: "27px", fontWeight: 700, color: "var(--color-text-primary)", marginTop: "10px", lineHeight: 1.2, letterSpacing: "-0.02em" }}>
          {plan.price === 0
            ? t("Бесплатно", "Bepul")
            : (
              <>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{plan.price.toLocaleString("ru")}</span>
                <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--color-text-secondary)" }}>
                  {" "}{t("сум/мес", "so'm/oy")}
                </span>
              </>
            )}
        </p>
      </div>

      <div style={{ height: "1px", background: "var(--color-border-subtle)" }} />

      {/* Что входит */}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "13.5px", flex: 1 }}>
        {limits.map(item => (
          <div key={item.label} style={{ display: "flex", alignItems: "center", gap: "9px" }}>
            <span style={{
              width: "19px", height: "19px", borderRadius: "50%", flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              // Акцент на карточке ОДИН. Зелёный здесь стоял рядом с
              // фирменным и спорил с ним: две ярких краски на одной карточке
              // читаются как несобранность, а на тёмной теме зелёный ещё и
              // кислотный. Зелёный остаётся за состоянием «хорошо», а не за
              // перечислением того, что входит.
              background: "var(--color-primary-subtle)", color: "var(--color-primary-text)",
            }}>
              <Check size={11} />
            </span>
            <span style={{ color: "var(--color-text-secondary)" }}>
              <span style={{ color: "var(--color-text-primary)", fontWeight: 600 }}>
                {item.max === null ? t("Безлимит", "Cheksiz") : item.max.toLocaleString("ru")}
              </span>{" "}{item.label}
            </span>
          </div>
        ))}

      </div>

      {/* ── Что умеет ──────────────────────────────────────────────────── */}
      <div style={{ height: "1px", background: "var(--color-border-subtle)" }} />

      <div style={{ display: "flex", flexDirection: "column", gap: "9px", fontSize: "13px" }}>
        {inherits && (
          <p style={{ fontSize: "12px", fontWeight: 700, color: "var(--color-primary-text)" }}>
            {t(`Всё из ${inherits}, плюс:`, `${inherits}dagi hammasi, ustiga:`)}
          </p>
        )}
        {adds.map(f => (
          <div key={f} style={{ display: "flex", alignItems: "flex-start", gap: "9px" }}>
            <span style={{
              width: "18px", height: "18px", borderRadius: "50%", flexShrink: 0, marginTop: "1px",
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "var(--color-primary-subtle)", color: "var(--color-primary-text)",
            }}>
              {f === "supportChat" ? <LifeBuoy size={10} /> : <Check size={10} />}
            </span>
            <span style={{ color: "var(--color-text-secondary)", lineHeight: 1.45 }}>
              {t(FEATURES[f].ru, FEATURES[f].uz)}
            </span>
          </div>
        ))}
      </div>

      {/* Не вместит. Сказать это ДО оплаты, а не после. */}
      {tooSmall.length > 0 && !isCurrent && (
        <div style={{
          display: "flex", alignItems: "flex-start", gap: "8px",
          padding: "10px 12px", borderRadius: "12px",
          background: "var(--color-warning-subtle)",
          fontSize: "12px", lineHeight: 1.45,
          color: "var(--color-warning-text, var(--color-warning))",
        }}>
          <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: "2px" }} />
          <span>
            {t("Не вместит: ", "Sig'maydi: ")}
            {tooSmall.map(l => `${l.short.toLowerCase()} ${l.used.toLocaleString("ru")}/${l.max?.toLocaleString("ru")}`).join(", ")}
          </span>
        </div>
      )}

      {isCurrent ? (
        <div style={{
          width: "100%", textAlign: "center", padding: "12px 20px", borderRadius: "14px",
          fontSize: "13.5px", fontWeight: 600,
          color: "var(--color-text-tertiary)", background: "var(--color-surface-light)",
          boxShadow: "var(--shadow-pressed)",
        }}>
          {t("Активен", "Faol")}
        </div>
      ) : (
        <button
          onClick={() => onSelect(plan.key)}
          disabled={isPending}
          className={isPro ? "neo-btn-primary" : "neo-btn"}
          style={{ width: "100%", height: "44px", borderRadius: "14px", fontSize: "13.5px" }}
        >
          {isPending ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <Zap size={15} />}
          {t("Подключить", "Ulash")}
        </button>
      )}
    </div>
  );
}
