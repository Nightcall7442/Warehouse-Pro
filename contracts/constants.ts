export const Session = {
  cookieName: "app_sid",
  maxAgeMs:   30 * 24 * 60 * 60 * 1000,  // 30 days — matches JWT expiry
} as const;

export const ErrorMessages = {
  unauthenticated:  "Authentication required",
  insufficientRole: "Insufficient permissions",
  /**
   * Отказ по подписке. Живёт здесь, а не в middleware, потому что по этому
   * тексту клиенты узнают причину отказа: веб уводит на экран оплаты, мобильное
   * показывает его агенту. Две копии одной строки разъехались бы при первой же
   * правке формулировки, и увод на оплату молча перестал бы работать.
   */
  subscriptionRequired: "Требуется активная подписка. Обновите тариф в настройках.",
} as const;

export const Paths = {
  login: "/login",
} as const;

// ── Plan definitions (single source of truth) ─────────────────────────────────
// Shared metadata used by both the local billing router (UZS) and the Stripe
// router (USD).  Currency-specific pricing lives in each router.

export const PLANS = {
  trial: {
    name:           "Trial",
    nameUz:         "Trial",
    nameRu:         "Пробный",
    maxUsers:       3,
    maxProducts:    20,
    maxOrdersMonth: 50,
    durationDays:   14,
  },
  basic: {
    name:           "Basic",
    nameUz:         "Basic",
    nameRu:         "Basic",
    maxUsers:       5,
    maxProducts:    50,
    maxOrdersMonth: null as number | null,
    durationDays:   30,
  },
  pro: {
    name:           "Pro",
    nameUz:         "Pro",
    nameRu:         "Pro",
    maxUsers:       20,
    maxProducts:    100,
    maxOrdersMonth: null as number | null,
    durationDays:   30,
  },
  exclusive: {
    name:           "Exclusive",
    nameUz:         "Exclusive",
    nameRu:         "Exclusive",
    maxUsers:       null as number | null,
    maxProducts:    null as number | null,
    maxOrdersMonth: null as number | null,
    durationDays:   30,
  },
} as const;

export type PlanKey = keyof typeof PLANS;

/** UZS prices — used by billing-router for local payment providers (Payme, Click, Uzum Pay) */
export const PLAN_PRICES_UZS: Record<PlanKey, number> = {
  trial:     0,
  basic:     299_000,
  pro:       599_000,
  exclusive: 1_299_000,
};
