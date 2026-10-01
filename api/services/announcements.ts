import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { announcementDismissals, announcements, type Announcement } from "@db/schema";
import { cache } from "../lib/cache";
import { recordPlatformAudit } from "./platform-audit";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

/* ═══════════════════════════════════════════════════════════════════════════
   Объявления организациям.

   ── Что было ────────────────────────────────────────────────────────────────

   Сказать всем клиентам «в субботу ночью обновление» или «появилась новая
   накладная» можно было только письмом каждому директору в Telegram — и
   агенты с операторами об этом не узнавали вовсе.

   ── Что теперь ──────────────────────────────────────────────────────────────

   Суперадмин пишет объявление (по-русски, при желании и по-узбекски), выбирает
   кому — всем, по тарифу, выбранным организациям — и срок. В приложении
   организаций оно стоит полосой вверху на языке пользователя, пока срок не
   вышел или человек его не закрыл. Закрытие хранится на сервере: директор
   заходит с телефона и с компьютера.

   ── Нагрузка ───────────────────────────────────────────────────────────────

   «Активные мне» зовёт каждый открытый экран каждого пользователя, поэтому:
   список незавершённых объявлений — одна копия на минуту на весь сервер
   (их единицы), отбор по организации и тарифу — в памяти, и только если
   кандидаты есть — один запрос «что этот человек уже закрыл» по ключу.
   Нет объявлений — нет ни одного запроса к базе.
   ═══════════════════════════════════════════════════════════════════════════ */

export const ANNOUNCEMENTS_CACHE_KEY = "announcements-live";

export interface AnnouncementInput {
  title: string;
  body: string;
  titleUz?: string | null;
  bodyUz?: string | null;
  level: "info" | "warning";
  audience: "all" | "plans" | "tenants";
  plans?: string[];
  tenantIds?: number[];
  startsAt: Date;
  endsAt?: Date | null;
}

const clean = (s: string | null | undefined) => (s ?? "").trim() || null;

/** Незавершённые: не закрыты вручную и срок не вышел (в том числе запланированные). */
async function liveAnnouncements(db: Db): Promise<Announcement[]> {
  const hit = cache.get<Announcement[]>(ANNOUNCEMENTS_CACHE_KEY);
  if (hit) return hit;
  const rows = await db.select().from(announcements)
    .where(and(isNull(announcements.endedAt), or(isNull(announcements.endsAt), gt(announcements.endsAt, sql`NOW()`))))
    .orderBy(desc(announcements.id))
    .limit(50);
  cache.set(ANNOUNCEMENTS_CACHE_KEY, rows, 60_000);
  return rows;
}

/** Кому адресовано: всем, по тарифу организации или по её номеру. */
export function addressedTo(a: Pick<Announcement, "audience" | "plans" | "tenantIds">, tenant: { id: number; plan: string }): boolean {
  if (a.audience === "all") return true;
  if (a.audience === "plans") return Array.isArray(a.plans) && (a.plans as string[]).includes(tenant.plan);
  return Array.isArray(a.tenantIds) && (a.tenantIds as number[]).map(Number).includes(tenant.id);
}

/**
 * Объявления, которые надо показать этому человеку сейчас. Суперадмину —
 * ничего: это сообщения платформы организациям, а не ему самому.
 */
export async function activeFor(db: Db, who: { userId: number; role: string; tenant: { id: number; plan: string } }, now = new Date()) {
  if (who.role === "superadmin") return [];
  const live = (await liveAnnouncements(db)).filter(a =>
    a.startsAt <= now && (!a.endsAt || a.endsAt > now) && !a.endedAt && addressedTo(a, who.tenant));
  if (live.length === 0) return [];
  const closed = await db.select({ id: announcementDismissals.announcementId }).from(announcementDismissals)
    .where(and(eq(announcementDismissals.userId, who.userId), inArray(announcementDismissals.announcementId, live.map(a => a.id))));
  const gone = new Set(closed.map(c => Number(c.id)));
  return live.filter(a => !gone.has(a.id)).map(a => ({
    id: a.id, level: a.level, title: a.title, body: a.body, titleUz: a.titleUz, bodyUz: a.bodyUz,
  }));
}

/** Закрыть для себя. Повторное закрытие — не ошибка. */
export async function dismiss(db: Db, who: { userId: number; tenantId: number }, announcementId: number): Promise<boolean> {
  const [a] = await db.select({ id: announcements.id }).from(announcements).where(eq(announcements.id, announcementId)).limit(1);
  if (!a) return false;
  await db.insert(announcementDismissals)
    .values({ announcementId, userId: who.userId, tenantId: who.tenantId })
    .onDuplicateKeyUpdate({ set: { announcementId } });
  return true;
}

/** Создать — вместе со следом в журнале владельца, одной транзакцией. */
export async function createAnnouncement(db: Db, input: AnnouncementInput, actor: { id: number; name: string }, ip: string | null) {
  const values = {
    title: input.title.trim(), body: input.body.trim(),
    titleUz: clean(input.titleUz), bodyUz: clean(input.bodyUz),
    level: input.level, audience: input.audience,
    plans: input.audience === "plans" ? [...new Set(input.plans ?? [])] : null,
    tenantIds: input.audience === "tenants" ? [...new Set(input.tenantIds ?? [])] : null,
    // Целые секунды вниз: столбец без долей, и MySQL ОКРУГЛЯЕТ — «с 12:00:00.7»
    // легло бы как 12:00:01, и только что опубликованное секунду не показывалось.
    startsAt: new Date(Math.floor(input.startsAt.getTime() / 1000) * 1000), endsAt: input.endsAt ?? null,
    createdById: actor.id, createdByName: actor.name,
  };
  const id = await db.transaction(async (tx) => {
    const [r] = await tx.insert(announcements).values(values);
    const newId = Number(r.insertId);
    await recordPlatformAudit(tx, {
      actor, action: "announcement.created", targetType: "announcement", targetId: newId, targetLabel: values.title,
      meta: { level: values.level, audience: values.audience, plans: values.plans, tenantIds: values.tenantIds, startsAt: values.startsAt, endsAt: values.endsAt },
      ip,
    }, { strict: true });
    return newId;
  });
  cache.invalidate(ANNOUNCEMENTS_CACHE_KEY);
  return { id };
}

/** «Завершить сейчас»: строка остаётся в прошедших. */
export async function endAnnouncement(db: Db, id: number, actor: { id: number; name: string }, ip: string | null, now = new Date()): Promise<boolean> {
  const ok = await db.transaction(async (tx) => {
    const [a] = await tx.select({ id: announcements.id, title: announcements.title, endedAt: announcements.endedAt })
      .from(announcements).where(eq(announcements.id, id)).for("update").limit(1);
    if (!a) return false;
    if (a.endedAt) return true;
    await tx.update(announcements).set({ endedAt: now }).where(eq(announcements.id, id));
    await recordPlatformAudit(tx, {
      actor, action: "announcement.ended", targetType: "announcement", targetId: id, targetLabel: a.title,
      ip,
    }, { strict: true });
    return true;
  });
  cache.invalidate(ANNOUNCEMENTS_CACHE_KEY);
  return ok;
}

/** Все объявления для раздела консоли — с числом закрывших. */
export async function listAnnouncements(db: Db) {
  const rows = await db.select().from(announcements).orderBy(desc(announcements.id)).limit(100);
  if (rows.length === 0) return [];
  const counts = await db.select({ id: announcementDismissals.announcementId, n: sql<string>`COUNT(*)` })
    .from(announcementDismissals)
    .where(inArray(announcementDismissals.announcementId, rows.map(r => r.id)))
    .groupBy(announcementDismissals.announcementId);
  const byId = new Map(counts.map(c => [Number(c.id), Number(c.n)]));
  return rows.map(r => ({ ...r, dismissed: byId.get(r.id) ?? 0 }));
}
