import { bizToday } from "@/lib/business-time";
import { useTranslate } from "@/i18n";
import { DateRangePicker } from "@/components/DateRangePicker";
import type { SectionPeriod } from "@/hooks/useSectionPeriod";

/**
 * Календарь в шапке раздела (hooks/useSectionPeriod).
 *
 * Показывает даты, за которые раздел посчитан сейчас, — свои или страницы.
 * «Сбросить» есть только у своего периода: он возвращает раздел к странице.
 */
export function SectionPeriodPicker({ period, testId, compact, align }: {
  period: SectionPeriod;
  testId?: string;
  /** Узкая панель — подпись без года (DateRangePicker.compact). */
  compact?: boolean;
  align?: "start" | "center" | "end";
}) {
  const t = useTranslate();
  return (
    <DateRangePicker
      from={period.from}
      to={period.to}
      max={bizToday()}
      onChange={period.set}
      onClear={period.own ? period.reset : undefined}
      active={period.own}
      aria-label={t("Период раздела", "Bo'lim davri")}
      testId={testId}
      compact={compact}
      align={align}
    />
  );
}
