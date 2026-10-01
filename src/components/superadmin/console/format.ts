/* Подписи и числа консоли платформы — только по-русски (владелец, 01.10.2026). */

/** Этапы пробного периода — как в панели владельца (api/services/owner-panel.ts, TRIAL_STAGES). */
export const STAGE_LABEL: Record<string, string> = {
  registered:    "Регистрация",
  emailVerified: "Почта подтверждена",
  products:      "Есть товары",
  agent:         "Заведён агент",
  agentOrder:    "Первый заказ агентом",
  delivered:     "Первая доставка",
  paid:          "Перешёл на платный",
};

/** Деньги — целыми, группами разрядов (неразрывные пробелы Intl — обычными). */
export const money = (n: number) => new Intl.NumberFormat("ru-RU").format(Math.round(n)).replace(/\s/g, " ");

/** «12.10.2026» — даты в консоли только по-русски. */
export const day = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";

/** «только что», «12 мин назад», «3 ч назад», «вчера», «5 дн. назад», дальше — дата. */
export function ago(d: Date | string | null | undefined, now = new Date()): string {
  if (!d) return "—";
  const ms = now.getTime() - new Date(d).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (ms < 60_000) return "только что";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} мин назад`;
  if (days < 1) return `${Math.floor(ms / 3_600_000)} ч назад`;
  if (days === 1) return "вчера";
  if (days < 30) return `${days} дн. назад`;
  return day(d);
}

/** «2026-10-15» (день без часов: оплата, период) → «15.10.2026» — без пересчёта поясов. */
export const dayOf = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
};

/** «12.10.2026 14:05» — когда в журнале. */
export const dayTime = (d: Date | string | null | undefined) =>
  d ? `${day(d)} ${new Date(d).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}` : "—";
