import { eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { tenants } from "@db/schema";
import { notifyTenantRole, tgEscape, fmtMoney } from "../lib/telegram";
import { logger } from "../lib/logger";
import { ControlService } from "../services/control";

/**
 * Вечер: деньги в поле — директору.
 *
 * Кассовая сводка ушла вместе с кассой; без неё директор узнавал о
 * несданных наличных только зайдя в «Контроль». Здесь — то же вечернее
 * письмо, но из заказов: сколько заказов ждут расчёта и на какую сумму, у
 * кого на руках наличные и с какого часа. Молчит, когда сдавать нечего.
 */
export function moneyEveningText(m: Awaited<ReturnType<typeof ControlService.money>>): string | null {
  if (m.awaiting.count === 0 && m.onHands.length === 0) return null;
  const lines = [`💵 <b>Деньги в поле · вечер</b>`];
  if (m.awaiting.count > 0) lines.push(`Ждут расчёта: <b>${m.awaiting.count}</b> на ${tgEscape(fmtMoney(m.awaiting.total))}`);
  if (m.onHands.length) {
    lines.push(`На руках (${m.onHands.length}):`);
    for (const h of m.onHands.slice(0, 15)) lines.push(`• ${tgEscape(h.name)} — ${tgEscape(fmtMoney(h.amount))} · ${h.orders} зак.${h.hours >= 24 ? ` ⚠️ ${Math.floor(h.hours / 24)} дн.` : ""}`);
  }
  lines.push(`Закрыть расчёт: Заказы → «Ждут расчёта».`);
  return lines.join("\n");
}

export async function runMoneyEvening(): Promise<{ tenants: number }> {
  const db = getDb();
  const rows = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.status, "active"));
  let sent = 0;
  for (const t of rows) {
    try {
      const text = moneyEveningText(await ControlService.money(db, t.id));
      if (!text) continue;
      await notifyTenantRole(t.id, "ceo", text);
      sent++;
    } catch (e) {
      logger.warn("money evening: организация пропущена", { tenantId: t.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  logger.info("money evening sent", { tenants: sent });
  return { tenants: sent };
}
