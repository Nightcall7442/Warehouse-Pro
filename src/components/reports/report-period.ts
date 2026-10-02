import { format, subDays } from "date-fns";
import { useUrlState, type UrlCodec } from "@/hooks/useUrlState";

/*
  Период раздела «Отчётов» в адресе: ?from=…&to=… — быстрые 7/30/90 дней и
  свой промежуток. Тот же приём, что у «Визитов без заказа»: ссылку «маржа за
  сентябрь по магазинам» можно переслать, и она откроется тем же.
*/

export const ymd = (d: Date) => format(d, "yyyy-MM-dd");
export const dmy = (day: string) => day.split("-").reverse().join(".");

/** Дата из адреса: не дата — значение по умолчанию; умолчание в адрес не пишется. */
export function dateCodec(fallback: string): UrlCodec<string> {
  return {
    parse: raw => (/^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : fallback),
    format: v => (v === fallback ? null : v),
  };
}

export const PRESET_DAYS = [7, 30, 90] as const;

export function useReportPeriod() {
  const today = ymd(new Date());
  const monthAgo = ymd(subDays(new Date(), 30));
  const [from, setFrom] = useUrlState("from", monthAgo, dateCodec(monthAgo));
  const [to, setTo] = useUrlState("to", today, dateCodec(today));
  const preset = (days: number) => { setFrom(ymd(subDays(new Date(), days))); setTo(today); };
  const presetOn = (days: number) => to === today && from === ymd(subDays(new Date(), days));
  return { from, to, today, setFrom, setTo, preset, presetOn };
}

