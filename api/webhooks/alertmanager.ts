import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { users } from "@db/schema";
import { getDb } from "../queries/connection";
import { env } from "../lib/env";
import { logger } from "../lib/logger";
import { safeEqual } from "../lib/safe-compare";
import { NotificationService } from "../services/NotificationService";
import { sendPushToUser } from "../services/push-service";

/*
  Второй канал тревог: AlertManager → приложение → телефон суперадмина.

  Единственным каналом был Telegram: сломается бот, потеряется чат, упадёт
  сам Telegram — и тревоги молча исчезают. Здесь AlertManager бьёт вебхуком
  в приложение, а оно кладёт тревогу в уведомления суперадминов и шлёт push
  на телефон — другой путь доставки, другая точка отказа.

  Ключ — в адресе (?secret=…): AlertManager не умеет подписывать запросы.
  Без переменной ALERTMANAGER_WEBHOOK_SECRET ручка закрыта.
*/

type AlertPayload = {
  status?: "firing" | "resolved";
  alerts?: Array<{
    status?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    startsAt?: string;
  }>;
};

const app = new Hono();

app.post("/", async (c) => {
  const secret = (process.env.ALERTMANAGER_WEBHOOK_SECRET ?? "").trim();
  if (!secret) return c.json({ error: "Webhook is not configured" }, 404);
  const given = c.req.query("secret") ?? "";
  if (!given || !safeEqual(given, secret)) return c.json({ error: "Unauthorized" }, 401);

  let payload: AlertPayload;
  try { payload = await c.req.json() as AlertPayload; } catch { return c.json({ error: "Bad JSON" }, 400); }
  const alerts = (payload.alerts ?? []).slice(0, 20);
  if (alerts.length === 0) return c.json({ ok: true, delivered: 0 });

  const db = getDb();
  const admins = await db.select({ id: users.id, tenantId: users.tenantId }).from(users)
    .where(and(eq(users.role, "superadmin"), eq(users.status, "active")));

  let delivered = 0;
  for (const a of alerts) {
    const firing = (a.status ?? payload.status) !== "resolved";
    const name = a.labels?.alertname ?? "тревога";
    const title = `${firing ? "🔴" : "✅"} ${a.annotations?.summary ?? name}`;
    const message = a.annotations?.description ?? "";
    logger[firing ? "error" : "info"]("alertmanager", { alert: name, firing, severity: a.labels?.severity });
    for (const admin of admins) {
      await NotificationService.create(db, {
        tenantId: admin.tenantId, userId: admin.id, type: "system", title, message, link: env.alertmanagerUrl || undefined,
      });
      if (firing) await sendPushToUser(admin.id, { title, body: message.slice(0, 200) }).catch(() => {});
      delivered++;
    }
  }
  return c.json({ ok: true, delivered });
});

export default app;
