import { useState } from "react";

/**
 * Свой период раздела страницы — поверх периода всей страницы.
 *
 * Владелец попросил календарь прямо в разделе («На чём заработали — от … до
 * …»): посмотреть один раздел за другой срок, не сбивая остальную страницу.
 * Раздел идёт за периодом страницы, пока в его календаре не выбрали свой.
 *
 * Свой период живёт до смены периода страницы: выбрал вверху «90 дней» —
 * значит, хочешь всю страницу за 90 дней, и раздел, оставшийся на прежних
 * датах, выглядел бы ошибкой. Поэтому выбор помнит, при каком периоде
 * страницы он сделан, и без эффектов сам гаснет, когда тот сменился.
 */
export interface SectionPeriod {
  from: string;
  to: string;
  /** Период выбран в самом разделе, а не взят у страницы. */
  own: boolean;
  set: (from: string, to: string) => void;
  /** Вернуть раздел к периоду страницы. */
  reset: () => void;
}

export function useSectionPeriod(pageFrom: string, pageTo: string): SectionPeriod {
  const page = `${pageFrom}_${pageTo}`;
  const [pick, setPick] = useState<{ from: string; to: string; page: string } | null>(null);
  const active = pick && pick.page === page ? pick : null;
  return {
    from: active?.from ?? pageFrom,
    to: active?.to ?? pageTo,
    own: active !== null,
    set: (from, to) => setPick({ from, to, page }),
    reset: () => setPick(null),
  };
}
