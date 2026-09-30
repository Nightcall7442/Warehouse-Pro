import { format, startOfMonth, startOfWeek, subDays } from "date-fns";
import type { OrderSortKey, OrderSortDir } from "@contracts/order-list";

/*
  Что показывает страница «Заказы» — один расчёт на таблицу, плитки,
  «По агентам» и выгрузки.

  ── Что было ────────────────────────────────────────────────────────────────

  Поле «с» стояло на первом числе месяца, и этот период уходил в КАЖДЫЙ запрос
  страницы: во «Активные», в очереди «Ожидает» и «Ждут расчёта», в их числа.
  С первого числа всё, что оформили в прошлом месяце и ещё не закрыли, молча
  пропадало из работы: вечерняя проверка по справке («Ожидает = 0», «Ждут
  расчёта = 0») показывала ложный ноль, а «Контроль» — деньги у курьеров.

  Выгрузки жили отдельной копией: брали только два поля дат и не знали ни
  вкладки, ни статуса, ни агента, ни поиска, ни чипов «Сегодня»/«Вчера» —
  таблица показывала одно, файл уносил другое. «Эта неделя» начиналась с
  воскресенья, «Вчера» захватывало и сегодня.

  ── Что теперь ──────────────────────────────────────────────────────────────

  Очередь — это работа, у неё нет периода: «Активные», «Ожидает», «Ждут
  расчёта» и прочие открытые статусы видны целиком, пока человек САМ не
  выбрал даты или чип. Период по умолчанию (месяц) остался там, где он
  отчёт: «Архив» и плитки «Всего», «Доставлены», «Отменены», сумма.
  Выгрузка берёт ровно те же условия, что таблица.

  С 29.09.2026 всё это живёт в адресе страницы (pages/Orders.tsx), а список
  ещё и сортируется по столбцу. Порядок — такая же часть «того, что на
  экране», как фильтр: файл, отсортированный иначе, чем таблица, заставляет
  человека искать в нём те же строки заново. Поэтому сортировка идёт сюда же,
  в list, и выгрузка получает её тем же путём, что и условия.
*/

export type OrdersView = {
  section: "active" | "archive";
  /** Статус с плитки или из выпадашки; "money" — очередь «Ждут расчёта». */
  status: string;
  chips: { datePreset?: string; status?: string; paymentMethod?: string };
  /** Даты, которые человек выбрал сам; "" — не выбирал. */
  dateFrom: string;
  dateTo: string;
  search: string;
  agentIds: number[];
  /** Курьер: вечерняя сдача — его заказы, ждущие расчёта (ссылка из «Контроля»). */
  courierId?: number;
  /** Столбец и направление; без них — как было: новые сверху. */
  sortBy?: OrderSortKey;
  sortDir?: OrderSortDir;
};

type Period = { dateFrom?: string; dateTo?: string };
type ListStatus = "new" | "processing" | "shipped" | "pending" | "delivered" | "cancelled" | "returned";
type PaymentMethod = "cash" | "card" | "transfer" | "debt";

const day = (d: Date) => format(d, "yyyy-MM-dd");

/** Отчётный период по умолчанию — с первого числа по сегодня. */
export function monthToDate(today: Date): Required<Period> {
  return { dateFrom: day(startOfMonth(today)), dateTo: day(today) };
}

/** Период чипа. Неделя — с понедельника: так её считают здесь все, кроме getDay(). */
export function presetPeriod(preset: string | undefined, today: Date): Required<Period> | null {
  switch (preset) {
    case "today": return { dateFrom: day(today), dateTo: day(today) };
    case "yesterday": { const y = day(subDays(today, 1)); return { dateFrom: y, dateTo: y }; }
    case "week": return { dateFrom: day(startOfWeek(today, { weekStartsOn: 1 })), dateTo: day(today) };
    case "month": return monthToDate(today);
    default: return null;
  }
}

/** Выбранное человеком поверх умолчания: пустое поле берёт своё из fallback. */
function withFallback(v: OrdersView, fallback: Period): Period {
  return { dateFrom: v.dateFrom || fallback.dateFrom, dateTo: v.dateTo || fallback.dateTo };
}

export function ordersQuery(v: OrdersView, today: Date = new Date()) {
  const preset = presetPeriod(v.chips.datePreset, today);
  const awaitingMoney = v.status === "money";
  const status = (v.chips.status ?? (awaitingMoney ? "" : v.status)) || undefined;
  // Очередь «Ждут расчёта» и вкладка «Активные» — работа: без периода по умолчанию.
  const isQueue = awaitingMoney || v.section === "active";
  const period = preset ?? withFallback(v, isQueue ? {} : monthToDate(today));
  const narrow = {
    search: v.search || undefined,
    agentIds: v.agentIds.length > 0 ? v.agentIds : undefined,
    courierId: v.courierId,
    paymentMethod: v.chips.paymentMethod as PaymentMethod | undefined,
  };
  const list = {
    ...narrow,
    ...period,
    status: status as ListStatus | undefined,
    // Вкладка сужает статус, а не заменяет: см. OrderService.list.
    archived: v.section === "archive",
    awaitingMoney: awaitingMoney || undefined,
    sortBy: v.sortBy,
    sortDir: v.sortDir,
  };
  return {
    /** Таблица, доска — и Excel/PDF: выгрузка обязана унести то, что на экране. */
    list,
    /** Плитки-отчёт: «Всего», «Доставлены», «Отменены», сумма — всегда за период. */
    reportStats: { ...narrow, ...(preset ?? withFallback(v, monthToDate(today))), status },
    /** Плитки-очереди: «Ожидает», «Новые», «В обработке», «Отгружены», «Ждут расчёта». */
    queueStats: { ...narrow, ...(preset ?? withFallback(v, {})), status },
    /** «По агентам» и выпадашка агентов — тот же срез, что таблица. */
    agentSummary: { ...period, archived: v.section === "archive", search: narrow.search },
    /** Что стоит в полях дат: то, что применено к таблице. */
    shown: { dateFrom: period.dateFrom ?? "", dateTo: period.dateTo ?? "" },
  };
}

/** Заголовок выгрузки — по-русски, это бумага. */
export function exportTitle(v: OrdersView, p: Period): string {
  const what = v.status === "money" ? "Ждут расчёта" : v.section === "archive" ? "Архив заказов" : "Активные заказы";
  const when = p.dateFrom && p.dateTo ? `${p.dateFrom} — ${p.dateTo}`
    : p.dateFrom ? `с ${p.dateFrom}` : p.dateTo ? `по ${p.dateTo}` : "без периода";
  return `${what} · ${when}`;
}
