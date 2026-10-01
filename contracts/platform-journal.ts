import { TENANT_PLAN_LABEL } from "./entity-labels";
import { PAYMENT_METHOD_LABEL, type PaymentMethod } from "./subscription-payment";

/*
  Журнал владельца платформы: как называются действия и как читается
  «было → стало». Консоль только русская (владелец, 01.10.2026).

  Имена действий — константы здесь, а не строки по роутерам: раздел
  «Журнал» отбирает по ним, и опечатка в одном месте давала бы действие,
  которого нет ни в одном фильтре.
*/

export const PLATFORM_ACTIONS = {
  "tenant.created":           "Создана организация",
  "tenant.status":            "Статус организации",
  "tenant.plan":              "Тариф изменён",
  "tenant.trial_extended":    "Продлён пробный",
  "tenant.extra_limits":      "Сверх тарифа",
  "tenant.manual":            "Руководство дистрибьютора",
  "tenant.operator_access":   "Права оператора",
  "tenant.offboarded":        "Организация удалена",
  "tenant.sandbox_created":   "Песочница интегратора",
  "user.password_reset":      "Сброшен пароль",
  "user.login_changed":       "Сменён логин сотрудника",
  "payment.recorded":         "Записана оплата",
  "announcement.created":     "Объявление",
  "announcement.ended":       "Объявление завершено",
  "support.purged":           "Стёрта переписка",
  "audit.purged":             "Убран журнал организации",
  "system.errors_purged":     "Очищен журнал ошибок",
  "lead.handled":             "Заявка обработана",
  "superadmin.login_changed": "Сменён свой логин",
} as const;
export type PlatformAction = keyof typeof PLATFORM_ACTIONS;

/** Группы для отбора в разделе «Журнал»: по началу имени действия. */
export const PLATFORM_ACTION_GROUPS: Array<{ key: string; label: string; actions: PlatformAction[] }> = [
  { key: "money",    label: "Тарифы и оплаты", actions: ["payment.recorded", "tenant.plan", "tenant.trial_extended", "tenant.extra_limits", "tenant.manual"] },
  { key: "orgs",     label: "Организации",     actions: ["tenant.created", "tenant.status", "tenant.offboarded", "tenant.sandbox_created", "tenant.operator_access"] },
  { key: "people",   label: "Логины и пароли", actions: ["user.password_reset", "user.login_changed", "superadmin.login_changed"] },
  { key: "comms",    label: "Объявления и заявки", actions: ["announcement.created", "announcement.ended", "lead.handled"] },
  { key: "cleanup",  label: "Уборка данных",   actions: ["support.purged", "audit.purged", "system.errors_purged"] },
];

export const actionLabel = (a: string): string => (PLATFORM_ACTIONS as Record<string, string>)[a] ?? a;

const day = (v: unknown): string => {
  if (!v) return "—";
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Tashkent" });
};
const plan = (v: unknown) => TENANT_PLAN_LABEL[v as keyof typeof TENANT_PLAN_LABEL]?.ru ?? String(v ?? "—");
const yesNo = (v: unknown) => (v ? "выдано" : "не выдано");
const status = (v: unknown) => (v === "active" ? "работает" : v === "suspended" ? "приостановлена" : String(v ?? "—"));
const money = (n: unknown) => `${new Intl.NumberFormat("ru-RU").format(Math.round(Number(n) || 0)).replace(/\s/g, " ")} сум`;

/** Поля «было → стало»: подпись и как показать значение. */
const FIELDS: Record<string, { label: string; show: (v: unknown) => string }> = {
  plan:          { label: "Тариф", show: plan },
  status:        { label: "Статус", show: status },
  periodEnds:    { label: "Оплачено до", show: day },
  trialEndsAt:   { label: "Пробный до", show: day },
  extraUsers:    { label: "Мест сверх тарифа", show: v => String(v ?? 0) },
  extraProducts: { label: "Товаров сверх тарифа", show: v => String(v ?? 0) },
  email:         { label: "Логин", show: v => String(v ?? "—") },
  manual:        { label: "Руководство", show: yesNo },
};

/**
 * «Тариф: Базовый → Про · Оплачено до: 12.10.2026 → 12.11.2026» и
 * подробности, которые были у действия: сумма, способ, период оплаты.
 */
export function describePlatformEntry(e: { action: string; before?: unknown; after?: unknown; meta?: unknown }): string {
  const before = (e.before ?? {}) as Record<string, unknown>;
  const after = (e.after ?? {}) as Record<string, unknown>;
  const meta = (e.meta ?? {}) as Record<string, unknown>;
  const parts: string[] = [];

  if (e.action === "payment.recorded") {
    parts.push(`${money(meta.amount)} · ${PAYMENT_METHOD_LABEL[meta.method as PaymentMethod] ?? String(meta.method ?? "")}`);
    if (meta.periodFrom && meta.periodTo) parts.push(`период ${day(meta.periodFrom)}–${day(meta.periodTo)}`);
  }

  for (const [k, f] of Object.entries(FIELDS)) {
    const has = k in after || k in before;
    if (!has) continue;
    const a = f.show(before[k]);
    const b = f.show(after[k]);
    if (k in before && k in after) { if (a !== b) parts.push(`${f.label}: ${a} → ${b}`); }
    else if (k in after) parts.push(`${f.label}: ${b}`);
  }

  if (e.action === "announcement.created") {
    const plans = Array.isArray(meta.plans) ? (meta.plans as string[]).map(plan).join(", ") : "";
    const ids = Array.isArray(meta.tenantIds) ? meta.tenantIds.length : 0;
    parts.push(meta.audience === "plans" ? `тарифы: ${plans}` : meta.audience === "tenants" ? `организаций: ${ids}` : "всем организациям");
    if (meta.level === "warning") parts.push("внимание");
    parts.push(meta.endsAt ? `с ${day(meta.startsAt)} до ${day(meta.endsAt)}` : `с ${day(meta.startsAt)}, без срока`);
  }
  if (e.action === "tenant.offboarded" && meta.total !== undefined) parts.push(`стёрто строк: ${meta.total}`);

  if (typeof meta.text === "string" && meta.text) parts.push(meta.text);
  return parts.join(" · ");
}
