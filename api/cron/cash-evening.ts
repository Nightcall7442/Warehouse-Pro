import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { settings, tenants, users } from "@db/schema";
import { logger } from "../lib/logger";
import { sendTelegram, notifyTenantRole, tgEscape, fmtMoney } from "../lib/telegram";
import { CashService } from "../services/cash";
import { NonCashService } from "../services/noncash";

/**
 * Вечер кассы: кто не сдал наличные и не закрыт ли день.
 *
 * Сотруднику с деньгами на руках — личное напоминание «сдайте до 19:00»;
 * директору — список тех, у кого деньги остались, и предупреждение, если
 * день не закрыт. Час сдачи у каждой организации свой (settings.cashDeadline),
 * крон стоит на 19:30 — после самого позднего разумного срока.
 */
export async function runCashEvening(): Promise<{ reminded: number; tenants: number }> {
  const db = getDb();
  const rows = await db.select({ id: tenants.id, name: tenants.name, deadline: settings.cashDeadline })
    .from(tenants).leftJoin(settings, eq(settings.tenantId, tenants.id))
    .where(eq(tenants.status, "active"));

  let reminded = 0, touched = 0;
  for (const t of rows) {
    try {
      const o = await CashService.overview(db, t.id);
      const nc = await NonCashService.summary(db, t.id);
      const withCash = o.holders.filter(h => h.onHand > 0);
      if (withCash.length === 0 && o.dayClosed && nc.overdue.count === 0) continue;
      touched++;

      const chats = withCash.length
        ? await db.select({ id: users.id, chatId: users.telegramChatId }).from(users)
          .where(and(eq(users.tenantId, t.id), inArray(users.id, withCash.map(h => h.id))))
        : [];
      const chatOf = new Map(chats.map(c => [Number(c.id), c.chatId]));
      for (const h of withCash) {
        const chatId = chatOf.get(h.id);
        if (!chatId) continue;
        const ok = await sendTelegram(chatId,
          `💵 <b>Наличные на руках: ${tgEscape(fmtMoney(h.onHand))}</b>\n` +
          `Сдайте в кассу до ${tgEscape(t.deadline ?? "19:00")} — кассир примет и подтвердит.` +
          (h.overLimit ? `\n⚠️ Это больше лимита ${tgEscape(fmtMoney(o.limit))}.` : ""));
        if (ok) reminded++;
      }

      const lines = withCash.slice(0, 15).map(h => `• ${tgEscape(h.name)} — ${tgEscape(fmtMoney(h.onHand))}${h.overLimit ? " ⚠️" : ""}`);
      const text =
        `🏦 <b>Касса · вечер</b>\n` +
        (lines.length ? `Не сдали наличные (${withCash.length}):\n${lines.join("\n")}\n` : `Все наличные сданы.\n`) +
        `\nСейф по системе: <b>${tgEscape(fmtMoney(o.office))}</b>` +
        (o.dayClosed ? "" : `\n⏰ День ещё не закрыт — закройте с пересчётом сейфа.`) +
        nonCashLines(nc);
      await notifyTenantRole(t.id, "ceo", text);
    } catch (e) {
      logger.warn("cash evening: организация пропущена", { tenantId: t.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  logger.info("cash evening sent", { reminded, tenants: touched });
  return { reminded, tenants: touched };
}

/**
 * Безнал без подтверждения банком. «В пути» — просто цифра; «просрочено»
 * (дольше settings.bankConfirmDays) — по людям: перевод, который так и не
 * пришёл, висит на том, кто его записал.
 */
export function nonCashLines(nc: Awaited<ReturnType<typeof NonCashService.summary>>): string {
  if (nc.transit.count === 0 && nc.overdue.count === 0) return "";
  const late = nc.byEmployee.filter(e => e.overdueCount > 0).slice(0, 10)
    .map(e => `• ${tgEscape(e.name)} — ${e.overdueCount} на ${tgEscape(fmtMoney(e.overdueTotal))}`);
  return `\n\n💳 Безнал в пути: ${nc.transit.count + nc.overdue.count} на <b>${tgEscape(fmtMoney(nc.transit.total + nc.overdue.total))}</b>` +
    (nc.overdue.count ? `\n🛑 Не подтверждены дольше ${nc.days} дн.: ${nc.overdue.count} на ${tgEscape(fmtMoney(nc.overdue.total))}\n${late.join("\n")}` : "");
}

/**
 * Ночная проверка цепочки документов: подмена строки в базе не должна
 * пережить ночь незамеченной. Разрыв — директору и владельцу платформы.
 */
export async function runCashChainCheck(): Promise<{ checked: number; broken: number[] }> {
  const db = getDb();
  const rows = await db.select({ id: tenants.id, name: tenants.name }).from(tenants).where(eq(tenants.status, "active"));
  const broken: number[] = [];
  for (const t of rows) {
    const r = await CashService.verify(db, t.id);
    if (!r.ok) {
      broken.push(t.id);
      await notifyTenantRole(t.id, "ceo", `🛑 <b>Касса: цепочка документов нарушена</b>\nРазрыв на документе #${tgEscape(r.brokenAt)} — данные правили мимо программы. Проверьте журнал и позвоните в поддержку.`);
      const { notifyAdmin } = await import("../lib/telegram");
      await notifyAdmin(`🛑 <b>Касса: разрыв цепочки</b>\n🏢 ${tgEscape(t.name)} · документ #${tgEscape(r.brokenAt)}`);
    }
  }
  if (broken.length) logger.error("cash chain broken", { tenants: broken });
  return { checked: rows.length, broken };
}
