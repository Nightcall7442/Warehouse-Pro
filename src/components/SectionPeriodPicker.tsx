import { format } from "date-fns";
import { useTranslate } from "@/i18n";
import { DateRangePicker } from "@/components/DateRangePicker";
import type { SectionPeriod } from "@/hooks/useSectionPeriod";

/**
 * Календарь в шапке раздела (hooks/useSectionPeriod).
 *
 * Показывает даты, за которые раздел посчитан сейчас, — свои или страницы.
 * «Сбросить» есть только у своего периода: он возвращает раздел к странице.
 */
export function SectionPeriodPicker({ period, testId }: { period: SectionPeriod; testId?: string }) {
  const t = useTranslate();
  return (
    <DateRangePicker
      from={period.from}
      to={period.to}
      max={format(new Date(), "yyyy-MM-dd")}
      onChange={period.set}
      onClear={period.own ? period.reset : undefined}
      active={period.own}
      aria-label={t("Период раздела", "Bo'lim davri")}
      testId={testId}
    />
  );
}
