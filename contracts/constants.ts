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
  basic: {
    name:           "Basic",
    nameUz:         "Basic",
    nameRu:         "Basic",
    maxUsers:       5,
    maxProducts:    1000,
    maxOrdersMonth: null as number | null,
    durationDays:   30,
  },
  pro: {
    name:           "Pro",
    nameUz:         "Pro",
    nameRu:         "Pro",
    maxUsers:       20,
    maxProducts:    10000,
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
  basic:     299_000,
  pro:       599_000,
  exclusive: 1_299_000,
};
