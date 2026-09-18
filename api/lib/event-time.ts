import { z } from "zod";

/*
  Когда это было на самом деле.

  Отметки визитов и доставок с телефона ждут связи часами: синхронизация
  вечером ставила всем визитам дня «18:40», доставка после полуночи уезжала в
  следующий день (оплата курьера «за довезённое» за период), а супервайзеру
  было нечего сверять с точками маршрута. У точек GPS поле «когда снято» есть
  ровно по этой причине (recordedAt) — здесь то же самое для событий.

  Поле необязательное: онлайн-путь его не шлёт, и «сейчас» остаётся как было.
  Часы телефона бывают неверны, поэтому время из будущего или старше недели
  не отвергает событие, а просто не принимается — визит важнее его часа.
*/
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_AHEAD_MS = 5 * 60 * 1000;

export const recordedAtInput = z.string().datetime({ offset: true }).optional();

export function eventTime(recordedAt: string | undefined, now: Date = new Date()): Date {
  if (!recordedAt) return now;
  const t = new Date(recordedAt).getTime();
  if (!Number.isFinite(t) || t > now.getTime() + MAX_AHEAD_MS || t < now.getTime() - MAX_AGE_MS) return now;
  return new Date(t);
}
