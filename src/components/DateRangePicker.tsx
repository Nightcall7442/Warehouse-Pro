import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLang } from "@/i18n";
import { dateLocale } from "@/lib/date-locale";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  clampDay, monthCells, monthEndOf, monthOf, orderRange, parseDay,
  quickRanges, rangeText, rangeTextShort, shiftDay, shiftMonthOf, toDay,
} from "@/lib/date-range";

/**
 * Период — календарём, а не двумя полями даты.
 *
 * Родное поле type="date" выглядит в каждом браузере по-своему, пустым
 * показывает «дд.мм.гггг», а период из двух таких полей набирается в два
 * захода с двумя всплывающими календарями, и ни один не видит другого: конец
 * раньше начала ставился без звука. Здесь период выбирается на одном
 * календаре двумя щелчками — начало и конец, — а между ними видна полоса
 * выбранных дней.
 *
 * Дни — строки «ГГГГ-ММ-ДД» (lib/date-range), ровно как их ждут отчёты.
 */
export interface DateRangePickerProps {
  /** Начало периода, «ГГГГ-ММ-ДД»; пустая строка — не задано. */
  from: string;
  /** Конец периода, включительно. */
  to: string;
  onChange: (from: string, to: string) => void;
  /** Раньше этого дня выбрать нельзя. */
  min?: string;
  /** Позже этого дня выбрать нельзя — обычно «сегодня»: продаж из будущего нет. */
  max?: string;
  /** Подпись кнопки, пока период не задан. */
  placeholder?: string;
  /** Подпись без года, если период в текущем году, — для узких панелей. */
  compact?: boolean;
  /** Кнопка нажата: период на экране выбран именно календарём. */
  active?: boolean;
  /** Задан — в календаре есть «Сбросить»: пустой период на этом экране что-то значит. */
  onClear?: () => void;
  align?: "start" | "center" | "end";
  "aria-label"?: string;
  testId?: string;
}

export function DateRangePicker({
  from, to, onChange, min, max, placeholder, active, onClear,
  align = "end", "aria-label": ariaLabel, testId, compact,
}: DateRangePickerProps) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const loc = dateLocale(lang);
  const phone = useIsMobile();
  const count = phone ? 1 : 2;

  const [open, setOpen] = useState(false);
  // Первый щелчок — начало; пока его нет, рисуется уже выбранный период.
  const [draft, setDraft] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  // Первый показанный месяц и день, на котором стоит клавиатура.
  const [view, setView] = useState(() => monthOf(to || toDay(new Date())));
  const [focus, setFocus] = useState(() => to || toDay(new Date()));
  const gridRef = useRef<HTMLDivElement>(null);
  const keyMoved = useRef(false);

  const today = toDay(new Date());
  const anchor = clampDay(to || from || today, min, max);

  const openAt = () => {
    setDraft(null);
    setHover(null);
    setFocus(anchor);
    // Конец периода — в правом месяце: «последние 30 дней» видны целиком,
    // а не обрезаны по первое число.
    setView(monthOf(shiftMonthOf(anchor, -(count - 1))));
  };

  const onOpenChange = (next: boolean) => {
    if (next) openAt();
    setOpen(next);
  };

  const commit = (a: string, b: string) => {
    const [lo, hi] = orderRange(a, b);
    onChange(lo, hi);
    setOpen(false);
  };

  const pick = (day: string) => {
    if (draft === null) {
      setDraft(day);
      setFocus(day);
      return;
    }
    commit(draft, day);
  };

  const months = Array.from({ length: count }, (_, i) => shiftMonthOf(view, i));
  const lastShown = monthEndOf(months[months.length - 1]);
  const canPrev = !min || shiftDay(view, -1) >= min;
  const canNext = !max || shiftDay(lastShown, 1) <= max;

  // Полоса: при выборе — от начала до дня под курсором, иначе — выбранный период.
  const [lo, hi] = draft !== null
    ? orderRange(draft, hover ?? focus ?? draft)
    : [from, to];

  const outOfBounds = (day: string) => (min !== undefined && day < min) || (max !== undefined && day > max);

  const moveFocus = (next: string) => {
    const day = clampDay(next, min, max);
    keyMoved.current = true;
    setFocus(day);
    if (draft !== null) setHover(day);
    if (day < view) setView(monthOf(day));
    else if (day > lastShown) setView(monthOf(shiftMonthOf(day, -(count - 1))));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, () => string> = {
      ArrowLeft: () => shiftDay(focus, -1),
      ArrowRight: () => shiftDay(focus, 1),
      ArrowUp: () => shiftDay(focus, -7),
      ArrowDown: () => shiftDay(focus, 7),
      PageUp: () => shiftMonthOf(focus, -1),
      PageDown: () => shiftMonthOf(focus, 1),
    };
    const go = step[e.key];
    if (!go) return;
    e.preventDefault();
    moveFocus(go());
  };

  // Клавиша сдвинула день — фокус идёт за ним, в том числе на соседний месяц.
  useEffect(() => {
    if (!keyMoved.current) return;
    keyMoved.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focus}"]`)?.focus();
  }, [focus, view]);

  const label = from || to
    ? (compact ? rangeTextShort(from, to, today) : rangeText(from, to))
    : (placeholder ?? t("Выбрать даты", "Sanani tanlang"));
  const quick = quickRanges(today, max).filter(q => !outOfBounds(q.from));
  const quickLabel = { today: t("Сегодня", "Bugun"), month: t("Этот месяц", "Bu oy"), prevMonth: t("Прошлый месяц", "O'tgan oy") };
  // 1 июня 2026 — понедельник: от него семь дней дают шапку недели на языке экрана.
  const weekdays = Array.from({ length: 7 }, (_, i) => format(parseDay(shiftDay("2026-06-01", i)), "EEEEEE", { locale: loc }));

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="neo-btn neo-btn-sm tap drp-trigger"
          aria-pressed={active}
          aria-label={ariaLabel ? `${ariaLabel}: ${label}` : undefined}
          data-testid={testId}
        >
          <CalendarDays size={14} aria-hidden />
          <span>{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        sideOffset={8}
        collisionPadding={16}
        className="drp-pop"
        onOpenAutoFocus={(e) => {
          // Radix ставит фокус на первую кнопку — стрелку «назад». Человеку с
          // клавиатуры нужен день, от которого идти стрелками.
          e.preventDefault();
          requestAnimationFrame(() => gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${anchor}"]`)?.focus());
        }}
        data-testid={testId ? `${testId}-calendar` : undefined}
      >
        <div className="drp-months" ref={gridRef} onKeyDown={onKeyDown}>
          {months.map((m, i) => (
            <div key={m} className="drp-month" role="group" aria-label={format(parseDay(m), "LLLL yyyy", { locale: loc })}>
              <div className="drp-head">
                {i === 0 ? (
                  <button type="button" className="drp-nav" onClick={() => setView(shiftMonthOf(view, -1))} disabled={!canPrev} aria-label={t("Предыдущий месяц", "Oldingi oy")}>
                    <ChevronLeft size={16} aria-hidden />
                  </button>
                ) : <span className="drp-nav-gap" />}
                <span className="drp-title">{format(parseDay(m), "LLLL yyyy", { locale: loc })}</span>
                {i === months.length - 1 ? (
                  <button type="button" className="drp-nav" onClick={() => setView(shiftMonthOf(view, 1))} disabled={!canNext} aria-label={t("Следующий месяц", "Keyingi oy")}>
                    <ChevronRight size={16} aria-hidden />
                  </button>
                ) : <span className="drp-nav-gap" />}
              </div>
              <div className="drp-grid">
                {weekdays.map((w, k) => <span key={k} className="drp-wd" aria-hidden>{w}</span>)}
                {monthCells(m).map((day, k) => {
                  if (day === null) return <span key={`gap-${k}`} />;
                  const isStart = !!lo && day === lo;
                  const isEnd = !!hi && day === hi;
                  const inRange = !!lo && !!hi && day > lo && day < hi;
                  const cls = ["drp-day"];
                  if (isStart) cls.push("is-start");
                  if (isEnd) cls.push("is-end");
                  if (inRange) cls.push("is-in-range");
                  if (day === today) cls.push("is-today");
                  return (
                    <button
                      key={day}
                      type="button"
                      data-day={day}
                      className={cls.join(" ")}
                      tabIndex={day === focus ? 0 : -1}
                      disabled={outOfBounds(day)}
                      aria-pressed={isStart || isEnd}
                      aria-label={format(parseDay(day), "d MMMM yyyy", { locale: loc })}
                      onClick={() => pick(day)}
                      onMouseEnter={() => draft !== null && setHover(day)}
                      onFocus={() => setFocus(day)}
                    >
                      {Number(day.slice(8))}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="drp-foot">
          <div className="drp-quick">
            {quick.map(q => (
              <button key={q.key} type="button" className="drp-chip" onClick={() => commit(q.from, q.to)}>
                {quickLabel[q.key]}
              </button>
            ))}
            {onClear && (from || to) && (
              <button type="button" className="drp-chip" onClick={() => { onClear(); setOpen(false); }}>
                {t("Сбросить", "Tozalash")}
              </button>
            )}
          </div>
          <span className="drp-status" aria-live="polite">
            {draft !== null
              ? t(`Начало ${rangeText(draft, draft)} — выберите конец`, `Boshi ${rangeText(draft, draft)} — oxirini tanlang`)
              : t("Выберите начало и конец периода", "Davr boshi va oxirini tanlang")}
          </span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
