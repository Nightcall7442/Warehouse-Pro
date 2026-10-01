import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../api/router";

/* ═══════════════════════════════════════════════════════════════════════════
   Список организаций консоли: фильтры, поиск, сортировка — без React.

   Отдельно от экрана, чтобы правило проверялось само по себе и одинаково
   работало в таблице, в поиске из шапки (Ctrl+K) и в счётчиках чипов.

   Сегменты (платит, пробный, молчит, продление) посчитаны на сервере тем же
   правилом, что панель владельца (api/services/owner-panel.ts, clientFlags):
   число на плитке «Обзора» и число на чипе здесь — одни и те же люди.
   ═══════════════════════════════════════════════════════════════════════════ */

export type OrgRow = inferRouterOutputs<AppRouter>["tenant"]["list"][number];

export const FILTERS = [
  { key: "all",       label: "Все" },
  { key: "paying",    label: "Платят" },
  { key: "trial",     label: "Пробные" },
  { key: "expiring",  label: "Истекают ≤14 дн" },
  { key: "silent",    label: "Молчат 5+ дн" },
  { key: "suspended", label: "Приостановлены" },
] as const;
export type FilterKey = (typeof FILTERS)[number]["key"];
export const isFilter = (v: string | null): v is FilterKey => FILTERS.some(f => f.key === v);

export function inFilter(o: OrgRow, f: FilterKey): boolean {
  switch (f) {
    case "all":       return true;
    case "paying":    return o.segment.paying;
    case "trial":     return o.segment.trial;
    case "expiring":  return o.segment.renewalDays !== null;
    case "silent":    return o.segment.silentDays !== null;
    case "suspended": return o.status === "suspended";
  }
}

/** Только цифры — телефон и ИНН ищутся без пробелов, скобок и «+998». */
const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

/**
 * Совпадает ли организация с запросом: название, slug, ИНН, телефон или
 * почта владельца. Регистр и «ё/е» не важны; в номере — только цифры, и
 * «90 123» находит «+998 90 123 45 67».
 */
export function matches(o: OrgRow, query: string): boolean {
  const q = norm(query.trim());
  if (!q) return true;
  const text = [o.name, o.slug, o.contactEmail, o.ownerEmail].map(norm).join("\n");
  if (text.includes(q)) return true;
  const d = digits(query);
  if (d.length >= 3) {
    if (digits(o.inn).includes(d)) return true;
    if (digits(o.contactPhone).includes(d) || digits(o.ownerPhone).includes(d)) return true;
  }
  return false;
}
const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/ё/g, "е");

export const SORTS = ["name", "plan", "ends", "users", "orders30", "revenue30", "activity"] as const;
export type SortKey = (typeof SORTS)[number];
export const isSort = (v: string | null): v is SortKey => SORTS.some(s => s === v);

const PLAN_RANK: Record<string, number> = { trial: 0, basic: 1, pro: 2, exclusive: 3 };

/** До какого дня у организации доступ: оплачено до — у платящих, конец пробного — у пробных. */
export function endsAt(o: OrgRow): Date | null {
  const sub = o.subscription;
  if (sub?.status === "trialing" || (!sub && o.plan === "trial")) {
    const t = sub?.trialEndsAt ?? o.trialEndsAt;
    return t ? new Date(t) : null;
  }
  const p = sub ? sub.currentPeriodEnds : o.planExpiresAt;
  return p ? new Date(p) : null;
}

/** Целых дней до конца срока (отрицательное — истёк), null — бессрочно. */
export function daysLeft(o: OrgRow, now = new Date()): number | null {
  const e = endsAt(o);
  return e ? Math.ceil((e.getTime() - now.getTime()) / 86_400_000) : null;
}

export function sortOrgs(rows: OrgRow[], key: SortKey, dir: "asc" | "desc"): OrgRow[] {
  const v = (o: OrgRow): number | string => {
    switch (key) {
      case "name":      return o.name.toLowerCase();
      case "plan":      return PLAN_RANK[planOf(o)] ?? 0;
      // Бессрочные — в конец при «по возрастанию»: продлевать их не нужно.
      case "ends":      return endsAt(o)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      case "users":     return o.userCount;
      case "orders30":  return o.orders30;
      case "revenue30": return o.revenue30;
      case "activity":  return new Date(o.lastActivityAt).getTime();
    }
  };
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = v(a), y = v(b);
    const c = typeof x === "string" ? x.localeCompare(y as string, "ru") : (x as number) - (y as number);
    return c !== 0 ? c * sign : a.name.localeCompare(b.name, "ru");
  });
}

export const PLANS = ["trial", "basic", "pro", "exclusive"] as const;
export type PlanFilter = (typeof PLANS)[number] | "";

/** Тариф организации — по подписке, как калитка доступа; без неё — по карточке. */
export const planOf = (o: OrgRow): string => o.subscription?.plan ?? o.plan;

/** Состояние списка в адресе: ?f=…&plan=…&q=…&sort=…&dir=… — ссылкой можно поделиться, «назад» возвращает фильтр. */
export function readListParams(p: URLSearchParams): { filter: FilterKey; plan: PlanFilter; q: string; sort: SortKey; dir: "asc" | "desc" } {
  const f = p.get("f");
  const s = p.get("sort");
  const pl = p.get("plan");
  return {
    filter: isFilter(f) ? f : "all",
    plan: PLANS.some(x => x === pl) ? (pl as PlanFilter) : "",
    q: p.get("q") ?? "",
    sort: isSort(s) ? s : "activity",
    dir: p.get("dir") === "asc" ? "asc" : "desc",
  };
}

/** Короткое имя статуса для таблицы — по подписке, как калитка доступа. */
export function statusOf(o: OrgRow, now = new Date()): { label: string; tone: "success" | "warning" | "danger" | "info" | "neutral" } {
  if (o.status === "suspended") return { label: "Приостановлена", tone: "danger" };
  if (o.isSandbox) return { label: "Песочница", tone: "neutral" };
  const sub = o.subscription;
  if (sub && sub.status !== "trialing" && sub.status !== "active") return { label: "Не оплачена", tone: "danger" };
  const d = daysLeft(o, now);
  // Пробный — по подписке (как endsAt), а не по сегменту: у песочницы и
  // приостановленной сегментов нет, а срок показать всё равно надо.
  if (sub?.status === "trialing" || (!sub && o.plan === "trial")) {
    if (d !== null && d <= 0) return { label: "Пробный истёк", tone: "danger" };
    return { label: "Пробный", tone: "info" };
  }
  if (d !== null && d <= 0) return { label: "Оплата истекла", tone: "danger" };
  return { label: "Платит", tone: "success" };
}
