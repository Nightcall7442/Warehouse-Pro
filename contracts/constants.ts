export const Session = {
  cookieName: "app_sid",
  maxAgeMs:   30 * 24 * 60 * 60 * 1000,  // 30 days — matches JWT expiry
} as const;

export const ErrorMessages = {
  unauthenticated:  "Authentication required",
  insufficientRole: "Insufficient permissions",
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
    nameUz:         "Sinov muddati",
    nameRu:         "Пробный период",
    maxUsers:       3,
    maxProducts:    50,
    maxOrdersMonth: 100,
    durationDays:   14,
  },
  basic: {
    name:           "Basic",
    nameUz:         "Asosiy",
    nameRu:         "Базовый",
    maxUsers:       10,
    maxProducts:    200,
    maxOrdersMonth: 500,
    durationDays:   30,
  },
  pro: {
    name:           "Professional",
    nameUz:         "Professional",
    nameRu:         "Профессиональный",
    maxUsers:       null as number | null,
    maxProducts:    null as number | null,
    maxOrdersMonth: null as number | null,
    durationDays:   30,
  },
} as const;

export type PlanKey = keyof typeof PLANS;

/** UZS prices — used by billing-router for local payment providers (Payme, Click, Uzum Pay) */
export const PLAN_PRICES_UZS: Record<PlanKey, number> = {
  trial: 0,
  basic: 49_000,
  pro:   149_000,
};
