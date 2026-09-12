/**
 * Работы по расписанию действительно запускаются.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Работы оформлены ручками HTTP: /api/cron/debt-reminders, /api/cron/backup,
 * /api/cron/trial-reminders. Ручки написаны, ключом закрыты, разобраны в коде
 * до мелочей — и НИ ОДНА НЕ ВЫЗЫВАЛАСЬ НИ РАЗУ. Проверено по счётчикам
 * Prometheus: по путям /api/cron/* за всё время наблюдения ноль запросов.
 *
 * Значит не уходили напоминания о долгах, не уходили напоминания об окончании
 * пробного периода, не делалась ночная копия базы. Снаружи всё выглядело
 * настроенным: код на месте, ключ задан, ручка честно отвечает 401 без ключа.
 * Отсутствие вызывателя не проявляется ничем, кроме тишины.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Время срабатывания по Ташкенту и то, что одна и та же работа не выполняется
 * дважды за минуту. Ошибка на час здесь означает сводку в три ночи, а двойной
 * запуск — две копии одного уведомления у каждого получателя.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../queries/connection", () => ({ getPool: () => null, getDb: vi.fn() }));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { _internals, scheduledJobs } = await import("../cron/scheduler");

/** Момент по UTC — Ташкент на пять часов впереди. */
const utc = (h: number, m = 0) => new Date(Date.UTC(2026, 8, 8, h, m, 0));

describe("когда что запускается", () => {
  const job = (name: string) => _internals.JOBS.find(j => j.name === name)!;

  it("все двенадцать работ на месте", () => {
    expect(_internals.JOBS.map(j => j.name).sort()).toEqual([
      "admin-digest", "agent-locations-cleanup", "api-export-log-cleanup", "backup", "debt-reminders",
      "low-stock-alerts", "notifications-cleanup", "restore-drill", "support-cleanup",
      "telegram-digest", "telegram-outbox", "trial-reminders",
    ]);
  });

  it("репетиция восстановления — только по воскресеньям, после ночной копии", () => {
    // 2026-09-13 — воскресенье; 05:00 по Ташкенту = 00:00 UTC.
    const sun = new Date(Date.UTC(2026, 8, 13, 0, 0, 0));
    const mon = new Date(Date.UTC(2026, 8, 14, 0, 0, 0));
    expect(_internals.isDue(job("restore-drill"), sun)).toBe(true);
    expect(_internals.isDue(job("restore-drill"), mon)).toBe(false);
  });

  it("стирающие работы разведены, а не слиты в одну", () => {
    /*
      Уборка чата и уборка уведомлений обе удаляют. Слитые в одну работу, они
      делили бы судьбу: споткнись первая — вторая не выполнилась бы вовсе, и
      узнали бы мы об этом по размеру базы через полгода.
    */
    expect(_internals.isDue(job("support-cleanup"), utc(22, 30))).toBe(true);        // 03:30 Ташкент
    expect(_internals.isDue(job("notifications-cleanup"), utc(22, 40))).toBe(true);  // 03:40 Ташкент
    // Третья стирающая — журнал выгрузок наружу, тем же правилом и своей минутой.
    expect(_internals.isDue(job("api-export-log-cleanup"), utc(22, 50))).toBe(true); // 03:50 Ташкент
    expect(_internals.isDue(job("notifications-cleanup"), utc(22, 30))).toBe(false);
  });

  it("уборка чата идёт ПОСЛЕ ночной копии", () => {
    /*
      Порядок здесь не косметический: уборка стирает переписку безвозвратно, и
      в копии, снятой до неё, эта переписка ещё есть. Поменяй их местами — и
      откатиться после ошибочного стирания будет некуда.
    */
    expect(_internals.isDue(job("backup"), utc(22, 0))).toBe(true);         // 03:00 Ташкент
    expect(_internals.isDue(job("support-cleanup"), utc(22, 30))).toBe(true); // 03:30 Ташкент
    expect(_internals.isDue(job("support-cleanup"), utc(22, 0))).toBe(false);
  });

  it("часы считаются по Ташкенту, а не по серверу", () => {
    /*
      Сервер живёт по UTC. Сводка назначена на двадцать часов ПО ТАШКЕНТУ —
      это пятнадцать по UTC. Спутать их значит прислать её в час ночи.
    */
    expect(_internals.isDue(job("telegram-digest"), utc(15, 0))).toBe(true);
    expect(_internals.isDue(job("telegram-digest"), utc(20, 0))).toBe(false);
  });

  it("долги — утром, копия — ночью", () => {
    // 09:00 Ташкент = 04:00 UTC.
    expect(_internals.isDue(job("debt-reminders"), utc(4, 0))).toBe(true);
    expect(_internals.isDue(job("debt-reminders"), utc(4, 1))).toBe(false);
    // 03:00 Ташкент = 22:00 UTC предыдущих суток.
    expect(_internals.isDue(job("backup"), utc(22, 0))).toBe(true);
  });

  it("очередь разбирается часто", () => {
    const outbox = job("telegram-outbox");
    // Каждые пять минут: накопленное за ночь должно уйти в восемь утра, а не
    // «когда-нибудь в течение часа».
    expect(_internals.isDue(outbox, utc(3, 0))).toBe(true);
    expect(_internals.isDue(outbox, utc(3, 5))).toBe(true);
    expect(_internals.isDue(outbox, utc(3, 7))).toBe(false);
  });

  it("отметка минуты не даёт выполнить работу дважды", () => {
    /*
      Тик раз в минуту, но таймер может дрогнуть и прийти дважды в ту же
      минуту. Для рассылки это две копии одного сообщения у каждого получателя.
    */
    expect(_internals.stamp(utc(4, 0))).toBe(_internals.stamp(utc(4, 0)));
    expect(_internals.stamp(utc(4, 0))).not.toBe(_internals.stamp(utc(4, 1)));
  });

  it("расписание можно прочитать человеческими словами", () => {
    const named = scheduledJobs();
    expect(named.find(j => j.name === "telegram-digest")?.when).toContain("20:00");
    expect(named.find(j => j.name === "telegram-outbox")?.when).toContain("5");
  });
});
