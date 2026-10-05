import { ErrorMessages } from "@contracts/constants";

/*
  Правила демо-организации жюри (/demo) — без базы и без сервисов.

  Отдельным модулем потому, что их читает основание всех процедур
  (api/middleware.ts) и auth.me: тяжёлый сервис досева со складом и долгами
  тянул бы за собой половину приложения в каждый тест роутера. Разбор того,
  что и почему закрыто, — в api/services/pitch-demo.ts.
*/

export const DEMO_ROLES = ["ceo", "agent", "supervisor"] as const;
export type DemoRole = typeof DEMO_ROLES[number];

export const isDemoRole = (v: unknown): v is DemoRole =>
  typeof v === "string" && (DEMO_ROLES as readonly string[]).includes(v);

/** Номер демо-организации из окружения; мусор и пустое — «выключено». */
export function pitchDemoTenantId(): number | null {
  const raw = process.env.PITCH_DEMO_TENANT_ID?.trim();
  if (!raw || !/^\d{1,10}$/.test(raw)) return null;
  const n = Number(raw);
  return n > 0 ? n : null;
}

/**
 * Демо-организация ли это.
 *
 * Оба условия сразу: номер совпал с переменной И в базе стоит пометка
 * песочницы. Номер без пометки — это опечатка в настройках, а не демо.
 */
export function isDemoTenant(tenant: { id: number; isSandbox?: boolean | null } | null | undefined): boolean {
  const id = pitchDemoTenantId();
  return id !== null && !!tenant && tenant.id === id && tenant.isSandbox === true;
}

/* ── Что закрыто демо-сессии ────────────────────────────────────────────────
   Пространства — целиком (все мутации, включая будущие): ключи API, оплата,
   1С, Telegram, приглашения, права ролей, оформление. */
export const DEMO_BLOCKED_NAMESPACES = [
  "apiKey", "billing", "stripe", "onec", "telegram", "invite", "access", "branding",
] as const;

/* Отдельные мутации в смешанных пространствах. */
export const DEMO_BLOCKED_MUTATIONS = [
  // своя учётная запись: пароль, логин, профиль, второй фактор, «выйти везде»
  "user.changePassword",
  "user.changeMyLogin",
  "user.updateMe",
  "user.totpSetup",
  "user.totpEnable",
  "user.totpDisable",
  "user.logoutAll",
  // люди и роли
  "user.update",
  "user.resetPassword",
  "user.deactivate",
  "user.transferCredentials",
  "tenant.inviteUser",
  // пароли и логины чужих людей — у суперадмина; роль демо туда не пустит,
  // но правило «пароль и вход не трогать» одно на всех
  "tenant.resetOwnerPassword",
  "tenant.changeUserLogin",
  // организация: реквизиты и логотип общие для всех, кто зашёл в демо
  "settings.update",
  // уход и удаление, журнал действий
  "tenant.offboard",
  "audit.purge",
] as const;

export function isBlockedForDemo(path: string): boolean {
  const ns = path.split(".")[0];
  return (DEMO_BLOCKED_NAMESPACES as readonly string[]).includes(ns)
    || (DEMO_BLOCKED_MUTATIONS as readonly string[]).includes(path);
}

/** Текст отказа — один на сервер и клиент; перевод в contracts/error-messages. */
export const DEMO_BLOCKED_MESSAGE: string = ErrorMessages.demoBlocked;
