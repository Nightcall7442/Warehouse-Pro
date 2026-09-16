import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { tenants, users } from "@db/schema";
import { logger } from "../lib/logger";
import { notifyEvent } from "../services/telegram-notify";
import { morningForAgent, morningForTeam, currencyOf } from "../telegram/answers";
import type { Lang } from "../telegram/texts";

/**
 * Утро в Telegram: план на день.
 *
 * ── Зачем ───────────────────────────────────────────────────────────────────
 *
 * Настройки обещали «план визитов утром» — и не слали ничего. Агент узнавал
 * свой маршрут, открыв приложение; если не открыл — ехал по памяти.
 *
 * Агенту и мерчандайзеру — его визиты с адресами и долгами магазинов (есть
 * что собрать по дороге). Директору и супервайзеру — сколько визитов у кого,
 * сколько доставок назначено, сколько заказов ждёт подтверждения.
 *
 * ── Кому ────────────────────────────────────────────────────────────────────
 *
 * Через notifyEvent «plan.morning»: правила организации решают, кому это
 * уходит, а тихие часы уже кончились — крон стоит на 8:05. Личный план идёт
 * одному человеку (onlyUserId), и в общий чат он не уходит: маршрут агента —
 * его рабочее, а не новость смены.
 */
const PLANS_WITH_BOT = ["trial", "pro", "exclusive"] as const;

export async function runTelegramMorning(): Promise<{ agents: number; managers: number }> {
  const db = getDb();
  const rows = await db.select({
    id: users.id, tenantId: users.tenantId, name: users.name, role: users.role, lang: users.telegramLang,
  })
    .from(users)
    .innerJoin(tenants, eq(tenants.id, users.tenantId))
    .where(and(
      eq(users.status, "active"),
      isNotNull(users.telegramChatId),
      inArray(users.role, ["ceo", "supervisor", "agent", "merchandiser"]),
      eq(tenants.status, "active"),
      inArray(tenants.plan, [...PLANS_WITH_BOT]),
    ));

  const currencies = new Map<number, string>();
  const currency = async (tenantId: number) => {
    let c = currencies.get(tenantId);
    if (!c) { c = await currencyOf(tenantId); currencies.set(tenantId, c); }
    return c;
  };

  let agents = 0, managers = 0;
  // Сводка команды считается один раз на организацию и язык.
  const teamReady = new Map<string, { text: string; extra?: Record<string, unknown> }>();

  for (const u of rows) {
    const lang: Lang = u.lang === "uz" ? "uz" : "ru";
    try {
      if (u.role === "agent" || u.role === "merchandiser") {
        const text = await morningForAgent({ tenantId: u.tenantId, lang, currency: await currency(u.tenantId), agentId: u.id, agentName: u.name });
        const r = await notifyEvent({ tenantId: u.tenantId, event: "plan.morning", onlyUserId: u.id, text });
        agents += r.sent + r.queued;
      } else {
        const key = `${u.tenantId}:${lang}`;
        let reply = teamReady.get(key);
        if (!reply) {
          reply = await morningForTeam({ tenantId: u.tenantId, lang, currency: await currency(u.tenantId) });
          teamReady.set(key, reply);
        }
        const r = await notifyEvent({ tenantId: u.tenantId, event: "plan.morning", onlyUserId: u.id, text: reply.text, extra: reply.extra });
        managers += r.sent + r.queued;
      }
    } catch (e) {
      logger.warn("telegram morning: не отправлено", { userId: u.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  logger.info("telegram morning sent", { agents, managers });
  return { agents, managers };
}
