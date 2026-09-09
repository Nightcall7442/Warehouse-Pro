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

/* ═══════════════════════════════════════════════════════════════════════════
   Что тариф даёт сверх чисел.

   ── Зачем один каталог ──────────────────────────────────────────────────────

   Возможности тарифов были написаны прозой на лендинге и НИГДЕ на экране
   оплаты: человек, который платит, сравнивал тарифы по трём числам —
   пользователи, товары, заказы. Чем Pro отличается от Basic по существу, на
   экране оплаты не говорилось вовсе.

   Теперь список один, и его читают обе страницы. Правило «чат поддержки — это
   Exclusive» и проверка публичного API читают его же, а не сравнивают с
   собственной строкой.

   ── Про `enforced` ──────────────────────────────────────────────────────────

   Признак говорит, ПРОВЕРЯЕТ ли это код. Сейчас проверяются ровно две
   возможности из списка — чат поддержки и API, — плюс числовые пределы
   (api/lib/plan-limits.ts). Остальное перечислено как обещание тарифа, но
   технически доступно на любом: GPS, обмен с 1С, оформление под свой бренд,
   аналитика ничем не ограничены.

   Врать на экране оплаты нельзя, поэтому признак стоит в коде рядом с
   названием, а не в чьей-то памяти: видно, где обещание подкреплено, а где
   держится на честном слове.
   ═══════════════════════════════════════════════════════════════════════════ */

export type FeatureKey =
  | "warehouse" | "mobile" | "reportsBasic" | "supportEmail"
  | "gps" | "onec" | "analytics" | "supportPriority"
  | "supportChat" | "api" | "whiteLabel" | "dataMigration" | "dedicatedServer";

export const FEATURES: Record<FeatureKey, { ru: string; uz: string; enforced: boolean }> = {
  warehouse:       { ru: "Склад, заказы, доставка",                 uz: "Ombor, buyurtmalar, yetkazish",                enforced: false },
  mobile:          { ru: "Мобильное приложение с офлайн-режимом",   uz: "Oflayn rejimli mobil ilova",                   enforced: false },
  reportsBasic:    { ru: "Базовые отчёты",                          uz: "Asosiy hisobotlar",                            enforced: false },
  supportEmail:    { ru: "Поддержка по почте",                      uz: "Pochta orqali yordam",                         enforced: false },

  gps:             { ru: "GPS-контроль агентов и курьеров",         uz: "Agentlar va kuryerlar GPS nazorati",           enforced: false },
  onec:            { ru: "Двусторонний обмен с 1С",                 uz: "1C bilan ikki tomonlama almashinuv",           enforced: false },
  analytics:       { ru: "Полная аналитика: прибыль, KPI, долги",   uz: "To'liq tahlil: foyda, KPI, qarzlar",           enforced: false },
  supportPriority: { ru: "Приоритетная поддержка",                  uz: "Ustuvor yordam",                               enforced: false },

  supportChat:     { ru: "Чат с поддержкой прямо в системе",        uz: "Tizim ichida qo'llab-quvvatlash chati",        enforced: true  },
  api:             { ru: "Доступ по API",                           uz: "API orqali kirish",                            enforced: true  },
  whiteLabel:      { ru: "Оформление под свой бренд",               uz: "O'z brendi ostida rasmiylashtirish",           enforced: false },
  dataMigration:   { ru: "Перенос данных из Excel и 1С",            uz: "Excel va 1C dan ma'lumot ko'chirish",          enforced: false },
  dedicatedServer: { ru: "Выделенный сервер",                       uz: "Ajratilgan server",                            enforced: false },
};

/**
 * Что не функция, а услуга.
 *
 * Приоритетная поддержка, перенос данных и выделенный сервер делаются людьми и
 * железом, а не кодом: включить их проверкой нельзя, и обещать на пробном
 * периоде — тоже. Набор нужен, чтобы «дать пробному всё» не превратилось в
 * обещание выделить сервер тому, кто зашёл посмотреть на две недели.
 */
export const SERVICE_FEATURES: readonly FeatureKey[] = [
  "supportPriority", "dataMigration", "dedicatedServer",
];

/**
 * Что тариф добавляет СВЕРХ предыдущего.
 *
 * Списком «добавляет», а не «включает всё»: иначе карточка Exclusive повторяет
 * тринадцать строк, из которых новых три, и разница между тарифами тонет.
 *
 * ── Почему у пробного здесь всё ─────────────────────────────────────────────
 *
 * Решение владельца: пробный период показывает продукт целиком.
 *
 * Стояло «склад, мобильное, базовые отчёты» — и пока разграничение по тарифам
 * не проверялось кодом, разницы не было никакой. Стоит проверку включить, и с
 * этим списком человек, пришедший посмотреть на две недели, увидит запертыми
 * GPS, обмен с 1С и аналитику — то есть ровно то, за что и платят. Продавать
 * продукт, спрятав от покупателя его половину, невозможно.
 *
 * Услуг здесь нет намеренно: см. SERVICE_FEATURES. Карточка пробного на экране
 * оплаты не показывается (billing отдаёт только покупаемые тарифы), так что
 * длина списка ничему не мешает — он работает только на доступ.
 */
export const PLAN_ADDS: Record<PlanKey, readonly FeatureKey[]> = {
  trial: [
    "warehouse", "mobile", "reportsBasic", "supportEmail",
    "gps", "onec", "analytics",
    "supportChat", "api", "whiteLabel",
  ],
  basic:     ["warehouse", "mobile", "reportsBasic", "supportEmail"],
  pro:       ["gps", "onec", "analytics", "supportPriority"],
  exclusive: ["supportChat", "api", "whiteLabel", "dataMigration", "dedicatedServer"],
};

/** Порядок тарифов от младшего к старшему — по нему копятся возможности. */
export const PLAN_ORDER: readonly PlanKey[] = ["trial", "basic", "pro", "exclusive"];

/** Всё, что даёт тариф, включая унаследованное от младших. */
export function planFeatures(plan: PlanKey): FeatureKey[] {
  const upTo = PLAN_ORDER.indexOf(plan);
  if (upTo < 0) return [];
  const out: FeatureKey[] = [];
  // trial стоит особняком: он ничего не наследует и ничему не передаёт — это
  // ознакомительный срок, а не ступень лестницы.
  const chain = plan === "trial" ? (["trial"] as const) : PLAN_ORDER.slice(1, upTo + 1);
  for (const key of chain) {
    for (const f of PLAN_ADDS[key]) if (!out.includes(f)) out.push(f);
  }
  return out;
}

/** Есть ли у тарифа возможность. По этому же решается доступ на сервере. */
export function planHas(plan: PlanKey, feature: FeatureKey): boolean {
  return planFeatures(plan).includes(feature);
}

/** UZS prices — used by billing-router for local payment providers (Payme, Click, Uzum Pay) */
/**
 * Сколько стоит одно место или один товар сверх тарифа — в месяц.
 *
 * Цены назначены владельцем и согласованы с лестницей тарифов, а не взяты с
 * потолка. Между Basic и Pro разница 300 000 сум за +50 товаров — то есть
 * 6 000 за товар; сверхлимитный стоит 5 000, чуть дешевле, и докупить пару
 * десятков выгоднее перехода. С местами наоборот: разница тарифов даёт 20 000
 * за место, а сверхлимитное стоит 35 000 — дороже, и при нужде в пятерых новых
 * сотрудниках выгоднее перейти на Pro. Так и задумано: надбавка закрывает
 * нехватку в несколько единиц, а не заменяет старший тариф.
 */
export const EXTRA_PRICES_UZS = {
  /** Одно рабочее место (пользователь). */
  user: 35_000,
  /** Одна позиция номенклатуры (SKU). */
  product: 5_000,
} as const;

export const PLAN_PRICES_UZS: Record<PlanKey, number> = {
  trial:     0,
  basic:     299_000,
  pro:       599_000,
  exclusive: 1_299_000,
};
